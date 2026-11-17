package com.rideoffercopilot.screenwatcher

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.os.SystemClock
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Runs on the capture thread, once per new screen frame (frames are event-driven since
 * vc13: the service reacts to each frame the moment the system delivers it).
 *
 * vc13 FAST PATH: a request card shown within ~1 s
 *  1. CardLocator finds the Accept/Match button by its pixels (a few ms, no OCR).
 *  2. Once the button holds still for two frames (the card has finished sliding in),
 *     only the card panel above it is OCR'd, in ONE pass, and those lines are emitted
 *     to JS straight away. JS parses fare, total time and total distance, grades, and
 *     draws the verdict before doing any bookkeeping.
 *  3. If our own persistent verdict covers part of the new card, it is hidden for one
 *     frame so the card can be read, then replaced by the new card's verdict (or put
 *     back if no new card was read).
 *
 * vc12 SLOW PATH (kept as the fallback for cards the locator does not recognise):
 *  full-frame OCR at most every 600 ms, static frames skipped, then a crop re-read of the
 *  detected card. vc12 ran ONLY this path, and that was the delay: see README.
 *
 * Card presence: after a card is emitted, a luminance snapshot of its box is compared
 * with every new frame (no OCR). When most of it changes the card has gone, and the next
 * card is treated as new. vc13: this no longer touches the verdict, which stays until the
 * driver dismisses it.
 *
 * No pixels ever leave this class: only recognized text is emitted, and the frame
 * bitmap is recycled immediately.
 */
internal class FrameProcessor(
  private val overlayRectInCapture: () -> Rect?,
  private val emit: (String, Map<String, Any?>) -> Unit,
) {
  private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

  private var prevThumb: IntArray? = null
  private var lastOcrAt = 0L
  private var lastSignature: String? = null
  private var lastFareKey: String? = null
  private var lastCardSeenAt = 0L
  private var lastEmitAt = 0L
  private var candidateState = ""
  private var candidateCount = 0
  private var emittedState = ""
  @Volatile private var closed = false

  // The card currently on screen.
  private var activeSeq = 0L
  private var lastEmittedSeq = 0L
  private var activeRect: Rect? = null
  private var activeRef: IntArray? = null
  private var ocrMisses = 0
  private var candidateUntil = 0L

  // vc13 fast path.
  private var lastButton: Rect? = null
  private var lastFastReadAt = 0L
  private var suspendRequested = false
  private var failedButton: Rect? = null
  private var failedAt = 0L

  /** True while a card is up or arriving: the service handles frames at the fast rate. */
  val fastMode: Boolean
    get() = activeSeq != 0L || lastButton != null || SystemClock.elapsedRealtime() < candidateUntil

  fun process(frame: Bitmap) {
    try {
      if (closed) return
      val now = SystemClock.elapsedRealtime()

      // A) Is the emitted card still there? (pixels only; never clears the verdict)
      var contentChanged = false
      if (activeSeq != 0L) {
        val f = changedFraction(frame)
        if (f >= GONE_FRACTION) endCard() else if (f >= CONTENT_CHANGE) contentChanged = true
      }

      // B) vc13 fast path.
      if (fastPath(frame, now, contentChanged)) return

      // C) vc12 slow path: full-frame OCR, for cards the locator does not recognise.
      val thumb = thumbnail(frame)
      val diff = prevThumb?.let { meanAbsDiff(it, thumb) } ?: Double.MAX_VALUE
      prevThumb = thumb
      if (activeSeq != 0L) {
        if (now - lastOcrAt < ACTIVE_FORCE_OCR_MS) return
      } else {
        val sliding = now < candidateUntil
        if (now - lastOcrAt < (if (sliding) SLIDING_OCR_GAP_MS else SLOW_OCR_GAP_MS)) return
        if (!sliding && diff < STATIC_DIFF && now - lastOcrAt < FORCE_OCR_MS) return
      }
      lastOcrAt = now

      val text = recognize(frame) ?: return
      val lines = visible(toLines(text, 0, 0))

      val card = OfferDetector.detect(lines, frame.width, frame.height)
      if (card != null) {
        onCardDetected(frame, card, lines, now, fromFast = false)
      } else {
        val r = activeRect
        if (activeSeq != 0L && r != null) {
          // Fare may be under our overlay: track the card by its lower part.
          if (OfferDetector.stillShowsCard(lines, r)) ocrMisses = 0 else if (++ocrMisses >= 2) endCard()
        } else if (OfferDetector.looksPartial(lines)) {
          candidateUntil = now + CANDIDATE_MS
        }
        if (lastSignature != null && now - lastCardSeenAt > CARD_GONE_MS) {
          lastSignature = null
          lastFareKey = null
        }
      }

      updateState(if (card != null) "offer" else OfferDetector.classifyState(lines))
    } finally {
      try { frame.recycle() } catch (_: Throwable) {}
    }
  }

  fun close() {
    closed = true
    if (activeSeq != 0L) endCard()
    if (suspendRequested) OverlayController.resumeAfterRead()
    try { recognizer.close() } catch (_: Throwable) {}
  }

  // --- vc13 fast path ---------------------------------------------------------------------

  /** Returns true when this frame was handled here (the slow path is skipped). */
  private fun fastPath(frame: Bitmap, now: Long, contentChanged: Boolean): Boolean {
    val ex = overlayRectInCapture()
    val btn = CardLocator.findAcceptButton(frame, ex)
    if (btn == null) {
      lastButton = null
      if (suspendRequested) {
        suspendRequested = false
        OverlayController.resumeAfterRead()
      }
      return false
    }
    val prev = lastButton
    lastButton = btn
    val tol = (frame.height * 0.006f).toInt().coerceAtLeast(3)
    val stable = prev != null && Math.abs(prev.top - btn.top) <= tol && Math.abs(prev.bottom - btn.bottom) <= tol
    if (!stable) {
      // The card is still sliding in: read it as soon as it settles (next frame or two).
      candidateUntil = now + CANDIDATE_MS
      return true
    }
    // The emitted card is still up and unchanged: nothing to read.
    if (activeSeq != 0L && !contentChanged) return true
    if (now - lastFastReadAt < FAST_RETRY_MS) return true
    // A coloured bar that is not a request (e.g. an in-trip slider): leave it to the slow path.
    val fb = failedButton
    if (fb != null && now - failedAt < FAILED_BACKOFF_MS && Math.abs(fb.top - btn.top) <= tol && Math.abs(fb.bottom - btn.bottom) <= tol) return false

    val region = CardLocator.cardRegion(frame, btn)
    // Our persistent verdict covers part of this card: hide it for one read.
    if (ex != null && Rect.intersects(ex, region)) {
      if (!suspendRequested) {
        suspendRequested = true
        OverlayController.suspendForRead()
      }
      return true
    }
    val suspendedAt = OverlayController.suspendedAt
    if (suspendedAt != 0L && now - suspendedAt < SUSPEND_SETTLE_MS) return true

    lastFastReadAt = now
    lastOcrAt = now
    val lines = readRegion(frame, region)
    val card = if (lines.isEmpty()) null else OfferDetector.detect(lines, frame.width, frame.height)
    val emitted = card != null && onCardDetected(frame, card, lines, now, fromFast = true)
    if (suspendRequested) {
      suspendRequested = false
      // A new verdict replaces the hidden one; otherwise put it back.
      if (!emitted) OverlayController.resumeAfterRead()
    }
    if (card == null) {
      failedButton = Rect(btn)
      failedAt = now
      return false
    }
    failedButton = null
    updateState("offer")
    return true
  }

  /** OCR of just the card panel, one pass; lines in frame coordinates. */
  private fun readRegion(frame: Bitmap, region: Rect): List<OcrLine> {
    val r = Rect(region)
    if (!r.intersect(0, 0, frame.width, frame.height) || r.width() < 10 || r.height() < 10) return emptyList()
    var crop: Bitmap? = null
    return try {
      crop = Bitmap.createBitmap(frame, r.left, r.top, r.width(), r.height())
      val t = recognize(crop!!) ?: return emptyList()
      visible(toLines(t, r.left, r.top))
    } catch (_: Throwable) {
      emptyList()
    } finally {
      if (crop != null && crop !== frame) try { crop.recycle() } catch (_: Throwable) {}
    }
  }

  // --- Card emission ----------------------------------------------------------------------

  /** Returns true when the card was emitted to JS as a new card. */
  private fun onCardDetected(frame: Bitmap, card: DetectedCard, lines: List<OcrLine>, now: Long, fromFast: Boolean): Boolean {
    candidateUntil = 0L
    ocrMisses = 0
    lastCardSeenAt = now
    val sameCard = (card.fareKey == lastFareKey && now - lastEmitAt < SAME_CARD_WINDOW_MS) || card.signature == lastSignature
    if (sameCard) {
      // A re-read of the card we already emitted: track it again, never re-emit it.
      if (activeSeq == 0L && lastEmittedSeq != 0L) activeSeq = lastEmittedSeq
      val r = Rect(card.rect)
      if (r.intersect(0, 0, frame.width, frame.height)) {
        activeRect = r
        activeRef = sampleBox(frame, r)
      }
      lastSignature = card.signature
      return false
    }
    val ok = if (fromFast) emitFromLines(frame, card, lines) else emitCard(frame, card, lines)
    if (ok) {
      lastEmitAt = now
      lastFareKey = card.fareKey
    }
    lastSignature = card.signature
    return ok
  }

  /** vc13 fast path: the card panel was already OCR'd on its own; emit those lines as-is. */
  private fun emitFromLines(frame: Bitmap, card: DetectedCard, lines: List<OcrLine>): Boolean {
    val r = Rect(card.rect)
    if (!r.intersect(0, 0, frame.width, frame.height) || r.width() < 10 || r.height() < 10) return false
    val cardLines = lines.filter { Rect.intersects(r, it.rect) }
    if (cardLines.isEmpty()) return false
    publish(frame, r, cardLines, r.left, r.top, r.width().toFloat(), r.height().toFloat(), "crop")
    return true
  }

  /** vc12 slow path: crop the detected card from the full frame and read it again. */
  private fun emitCard(frame: Bitmap, card: DetectedCard, frameLines: List<OcrLine>): Boolean {
    val r = Rect(card.rect)
    r.intersect(0, 0, frame.width, frame.height)
    if (r.width() < 10 || r.height() < 10) return false

    var pass = "crop"
    var cardLines: List<OcrLine> = emptyList()
    var normW = r.width().toFloat()
    var normH = r.height().toFloat()
    var crop: Bitmap? = null
    var scaled: Bitmap? = null
    try {
      crop = Bitmap.createBitmap(frame, r.left, r.top, r.width(), r.height())
      val up = if (r.width() < 900) 1.5f else 1f
      scaled = if (up != 1f) Bitmap.createScaledBitmap(crop, (r.width() * up).toInt(), (r.height() * up).toInt(), true) else crop
      val t = recognize(scaled!!)
      if (t != null) {
        cardLines = toLines(t, 0, 0)
        normW = scaled.width.toFloat()
        normH = scaled.height.toFloat()
      }
    } catch (_: Throwable) {
    } finally {
      if (scaled != null && scaled !== crop && scaled !== frame) try { scaled.recycle() } catch (_: Throwable) {}
      // createBitmap() may return the source itself for a full-frame crop.
      if (crop != null && crop !== frame) try { crop.recycle() } catch (_: Throwable) {}
    }

    var offsetX = 0
    var offsetY = 0
    if (cardLines.isEmpty()) {
      // Fall back to the full-frame read restricted to the card box.
      pass = "frame"
      cardLines = frameLines.filter { Rect.intersects(r, it.rect) }
      offsetX = r.left
      offsetY = r.top
      normW = r.width().toFloat()
      normH = r.height().toFloat()
    }
    if (cardLines.isEmpty()) return false
    publish(frame, r, cardLines, offsetX, offsetY, normW, normH, pass)
    return true
  }

  /** Starts a new card (new cardSeq) and sends its lines, normalized to the card box, to JS. */
  private fun publish(
    frame: Bitmap,
    r: Rect,
    cardLines: List<OcrLine>,
    offsetX: Int,
    offsetY: Int,
    normW: Float,
    normH: Float,
    pass: String,
  ) {
    if (activeSeq != 0L) CardPresence.end(activeSeq)
    val seq = CardPresence.begin()
    activeSeq = seq
    lastEmittedSeq = seq
    activeRect = Rect(r)
    activeRef = sampleBox(frame, r)
    ocrMisses = 0

    val sorted = cardLines.sortedWith(compareBy<OcrLine> { it.rect.top / 8 }.thenBy { it.rect.left })
    val arr = JSONArray()
    for (l in sorted) {
      val o = JSONObject()
      o.put("text", l.text)
      o.put("x", ((l.rect.left - offsetX) / normW).toDouble().coerceIn(0.0, 1.0))
      o.put("y", ((l.rect.top - offsetY) / normH).toDouble().coerceIn(0.0, 1.0))
      o.put("w", (l.rect.width() / normW).toDouble().coerceIn(0.0, 1.0))
      o.put("h", (l.rect.height() / normH).toDouble().coerceIn(0.0, 1.0))
      arr.put(o)
    }
    emit(
      "onCard",
      mapOf(
        "ts" to System.currentTimeMillis().toDouble(),
        "text" to sorted.joinToString("\n") { it.text },
        "linesJson" to arr.toString(),
        "cardTop" to (r.top.toDouble() / frame.height),
        "cardBottom" to (r.bottom.toDouble() / frame.height),
        "frameWidth" to frame.width,
        "frameHeight" to frame.height,
        "pass" to pass,
        "cardSeq" to seq.toDouble(),
      )
    )
  }

  // --- Card presence ----------------------------------------------------------------------

  /** The card left the screen. The verdict stays (vc13); the next card is treated as new. */
  private fun endCard() {
    val seq = activeSeq
    activeSeq = 0L
    activeRect = null
    activeRef = null
    ocrMisses = 0
    CardPresence.end(seq)
    lastSignature = null
    lastOcrAt = 0L
  }

  /** Grid point (x, y) of sample i inside box r. */
  private fun gridX(r: Rect, i: Int) = r.left + ((i % GRID_COLS) + 0.5f) * r.width() / GRID_COLS
  private fun gridY(r: Rect, i: Int) = r.top + ((i / GRID_COLS) + 0.5f) * r.height() / GRID_ROWS

  /** Luminance at a grid over the card box; −1 where our own overlay is (or off-frame). */
  private fun sampleBox(b: Bitmap, r: Rect): IntArray {
    val ex = overlayRectInCapture()
    val out = IntArray(GRID_COLS * GRID_ROWS)
    for (i in out.indices) {
      val x = gridX(r, i).toInt()
      val y = gridY(r, i).toInt()
      out[i] = if (x < 0 || y < 0 || x >= b.width || y >= b.height || (ex != null && ex.contains(x, y))) -1 else lum(b, x, y)
    }
    return out
  }

  /** Share of the card box that differs from the card's snapshot (0 when unknown). */
  private fun changedFraction(b: Bitmap): Double {
    val r = activeRect ?: return 0.0
    val ref = activeRef ?: return 0.0
    val ex = overlayRectInCapture()
    var valid = 0
    var changed = 0
    for (i in ref.indices) {
      if (ref[i] < 0) continue
      val x = gridX(r, i).toInt()
      val y = gridY(r, i).toInt()
      if (x >= b.width || y >= b.height || (ex != null && ex.contains(x, y))) continue
      valid++
      if (Math.abs(lum(b, x, y) - ref[i]) > CELL_CHANGE) changed++
    }
    if (valid < MIN_VALID_CELLS) return 0.0
    return changed.toDouble() / valid
  }

  private fun lum(b: Bitmap, x: Int, y: Int): Int {
    val c = b.getPixel(x, y)
    return (Color.red(c) * 299 + Color.green(c) * 587 + Color.blue(c) * 114) / 1000
  }

  // --- Screen state -----------------------------------------------------------------------

  private fun updateState(state: String) {
    if (state == candidateState) candidateCount++ else {
      candidateState = state
      candidateCount = 1
    }
    val needed = if (state == "offer") 1 else STATE_DEBOUNCE_FRAMES
    if (candidateCount >= needed && state != emittedState) {
      emittedState = state
      emit("onScreenState", mapOf("state" to state, "ts" to System.currentTimeMillis().toDouble()))
    }
  }

  // --- OCR helpers ------------------------------------------------------------------------

  private fun recognize(bitmap: Bitmap): Text? {
    if (closed) return null
    return try {
      Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0)), OCR_TIMEOUT_S, TimeUnit.SECONDS)
    } catch (_: Throwable) {
      null
    }
  }

  /** OCR lines, shifted by (dx, dy) into frame coordinates. */
  private fun toLines(text: Text, dx: Int, dy: Int): List<OcrLine> {
    val out = ArrayList<OcrLine>()
    for (block in text.textBlocks) {
      for (line in block.lines) {
        val box = line.boundingBox ?: continue
        val s = line.text.trim()
        if (s.isNotEmpty()) out.add(OcrLine(s, Rect(box.left + dx, box.top + dy, box.right + dx, box.bottom + dy)))
      }
    }
    return out
  }

  /** Drops any text under our own overlay: we must never read ourselves. */
  private fun visible(lines: List<OcrLine>): List<OcrLine> {
    val exclude = overlayRectInCapture() ?: return lines
    return lines.filter { !Rect.intersects(exclude, it.rect) }
  }

  private fun thumbnail(b: Bitmap): IntArray {
    val gw = 16
    val gh = 32
    val out = IntArray(gw * gh)
    val sx = b.width / gw.toFloat()
    val sy = b.height / gh.toFloat()
    for (gy in 0 until gh) {
      val y = ((gy + 0.5f) * sy).toInt().coerceIn(0, b.height - 1)
      for (gx in 0 until gw) {
        val x = ((gx + 0.5f) * sx).toInt().coerceIn(0, b.width - 1)
        val c = b.getPixel(x, y)
        out[gy * gw + gx] = (Color.red(c) * 299 + Color.green(c) * 587 + Color.blue(c) * 114) / 1000
      }
    }
    return out
  }

  private fun meanAbsDiff(a: IntArray, b: IntArray): Double {
    if (a.size != b.size) return Double.MAX_VALUE
    var sum = 0L
    for (i in a.indices) sum += Math.abs(a[i] - b[i])
    return sum.toDouble() / a.size
  }

  companion object {
    private const val STATIC_DIFF = 1.5
    private const val FORCE_OCR_MS = 2_500L
    private const val CARD_GONE_MS = 2_500L
    private const val SAME_CARD_WINDOW_MS = 20_000L
    private const val STATE_DEBOUNCE_FRAMES = 2
    private const val OCR_TIMEOUT_S = 4L
    // Slow path pacing (frames are event-driven since vc13; this keeps OCR at vc12's rate).
    private const val SLOW_OCR_GAP_MS = 600L
    private const val SLIDING_OCR_GAP_MS = 150L
    // Card presence
    private const val ACTIVE_FORCE_OCR_MS = 3_000L
    private const val CANDIDATE_MS = 2_000L
    private const val GRID_COLS = 12
    private const val GRID_ROWS = 16
    private const val CELL_CHANGE = 40
    private const val GONE_FRACTION = 0.5
    private const val CONTENT_CHANGE = 0.15
    private const val MIN_VALID_CELLS = 24
    // vc13 fast path
    private const val FAST_RETRY_MS = 500L
    private const val SUSPEND_SETTLE_MS = 90L
    private const val FAILED_BACKOFF_MS = 3_000L
  }
}
