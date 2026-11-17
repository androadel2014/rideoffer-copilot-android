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
 * Runs on the capture thread. For each frame:
 *  1. Skip OCR if the screen is visually unchanged (cheap 16x32 luminance diff).
 *  2. On-device OCR of the whole frame (ML Kit, bundled model).
 *  3. Drop any text that sits under our own overlay (we must never read ourselves).
 *  4. If an offer card is present and new: crop the card, upscale, OCR the crop again
 *     for a cleaner read, and emit the card lines (normalized to the card box) to JS.
 *  5. Classify the screen (offer / trip / idle / other) and emit debounced changes,
 *     which drive the wait-time tracker.
 *
 * vc12 timing (verdict WHILE the card is up, gone within ~0.5 s after it closes):
 *  - Each emitted card gets a sequence number (CardPresence) and a luminance snapshot of
 *    its box. While it is up, frames are grabbed every ~150 ms and compared with that
 *    snapshot (no OCR). When most of the box changes, the card is gone: the overlay is
 *    removed immediately and the next frame is read for a new card.
 *  - While a card is up, OCR only runs every few seconds (to re-confirm it by its lower
 *    part), so it cannot block the gone-check.
 *  - A card that is still sliding in (fare already readable) is re-read on the next
 *    frame instead of waiting for the normal cadence or the static-frame skip.
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

  // vc12: the card currently on screen.
  private var activeSeq = 0L
  private var activeRect: Rect? = null
  private var activeRef: IntArray? = null
  private var ocrMisses = 0
  private var candidateUntil = 0L
  /** Card that just left: not re-emitted while it is still sliding out. */
  private var goneFareKey: String? = null
  private var goneAt = 0L

  /** True while a card is up (or sliding in): the service grabs frames at the fast cadence. */
  val fastMode: Boolean
    get() = activeSeq != 0L || SystemClock.elapsedRealtime() < candidateUntil

  fun process(frame: Bitmap) {
    try {
      if (closed) return
      val now = SystemClock.elapsedRealtime()
      // vc12: cheap card-gone check on every new frame, before any OCR.
      if (activeSeq != 0L && cardLooksGone(frame)) endCard()
      val thumb = thumbnail(frame)
      val diff = prevThumb?.let { meanAbsDiff(it, thumb) } ?: Double.MAX_VALUE
      prevThumb = thumb
      if (activeSeq != 0L) {
        // A card is up: only re-confirm it now and then; the pixel check above handles "gone".
        if (now - lastOcrAt < ACTIVE_FORCE_OCR_MS) return
      } else {
        val sliding = now < candidateUntil
        if (!sliding && diff < STATIC_DIFF && now - lastOcrAt < FORCE_OCR_MS) return
      }
      lastOcrAt = now

      val text = recognize(frame) ?: return
      val exclude = overlayRectInCapture()
      val lines = toLines(text).filter { exclude == null || !Rect.intersects(exclude, it.rect) }

      val card = OfferDetector.detect(lines, frame.width, frame.height)
      if (card != null) {
        candidateUntil = 0L
        ocrMisses = 0
        val continuouslyVisible = lastSignature != null && now - lastCardSeenAt < CARD_GONE_MS
        lastCardSeenAt = now
        val isJitterOfSameCard = continuouslyVisible && card.fareKey == lastFareKey && now - lastEmitAt < SAME_CARD_WINDOW_MS
        val slidingOut = card.fareKey == goneFareKey && now - goneAt < REAPPEAR_BLOCK_MS
        if (slidingOut) {
          // The card that just left, caught mid-animation. Look again shortly; if it is
          // really still there it is emitted once the block ends.
          candidateUntil = now + CANDIDATE_MS
        } else if (card.signature != lastSignature && !isJitterOfSameCard) {
          emitCard(frame, card, lines)
          lastEmitAt = now
          lastFareKey = card.fareKey
          lastSignature = card.signature
        } else {
          if (activeSeq != 0L) {
            // Same card re-confirmed: refresh its snapshot (slow countdown animations).
            activeRect?.let { activeRef = sampleBox(frame, it) }
          }
          lastSignature = card.signature
        }
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
    try { recognizer.close() } catch (_: Throwable) {}
  }

  // --- Card emission ----------------------------------------------------------------------

  private fun emitCard(frame: Bitmap, card: DetectedCard, frameLines: List<OcrLine>) {
    val r = Rect(card.rect)
    r.intersect(0, 0, frame.width, frame.height)
    if (r.width() < 10 || r.height() < 10) return

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
        cardLines = toLines(t)
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
    if (cardLines.isEmpty()) return

    // vc12: this card is now the one on screen. A card it replaces loses its verdict.
    if (activeSeq != 0L) {
      CardPresence.end(activeSeq)
      OverlayController.hideForCard(activeSeq)
    }
    val seq = CardPresence.begin()
    activeSeq = seq
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

  // --- vc12: card presence ----------------------------------------------------------------

  /** The card left the screen: remove its verdict now and read the next frame for a new card. */
  private fun endCard() {
    val seq = activeSeq
    activeSeq = 0L
    activeRect = null
    activeRef = null
    ocrMisses = 0
    CardPresence.end(seq)
    OverlayController.hideForCard(seq)
    goneFareKey = lastFareKey
    goneAt = SystemClock.elapsedRealtime()
    lastSignature = null
    lastFareKey = null
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

  /** Most of the card box looks different from the card's snapshot → the card is gone. */
  private fun cardLooksGone(b: Bitmap): Boolean {
    val r = activeRect ?: return false
    val ref = activeRef ?: return false
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
    if (valid < MIN_VALID_CELLS) return false
    return changed >= valid * GONE_FRACTION
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

  private fun toLines(text: Text): List<OcrLine> {
    val out = ArrayList<OcrLine>()
    for (block in text.textBlocks) {
      for (line in block.lines) {
        val box = line.boundingBox ?: continue
        val s = line.text.trim()
        if (s.isNotEmpty()) out.add(OcrLine(s, box))
      }
    }
    return out
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
    // vc12 card presence
    private const val ACTIVE_FORCE_OCR_MS = 3_000L
    private const val CANDIDATE_MS = 2_000L
    private const val REAPPEAR_BLOCK_MS = 1_500L
    private const val GRID_COLS = 12
    private const val GRID_ROWS = 16
    private const val CELL_CHANGE = 40
    private const val GONE_FRACTION = 0.5
    private const val MIN_VALID_CELLS = 24
  }
}
