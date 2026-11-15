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

  fun process(frame: Bitmap) {
    try {
      if (closed) return
      val now = SystemClock.elapsedRealtime()
      val thumb = thumbnail(frame)
      val diff = prevThumb?.let { meanAbsDiff(it, thumb) } ?: Double.MAX_VALUE
      prevThumb = thumb
      if (diff < STATIC_DIFF && now - lastOcrAt < FORCE_OCR_MS) return
      lastOcrAt = now

      val text = recognize(frame) ?: return
      val exclude = overlayRectInCapture()
      val lines = toLines(text).filter { exclude == null || !Rect.intersects(exclude, it.rect) }

      val card = OfferDetector.detect(lines, frame.width, frame.height)
      if (card != null) {
        val continuouslyVisible = lastSignature != null && now - lastCardSeenAt < CARD_GONE_MS
        lastCardSeenAt = now
        val isJitterOfSameCard = continuouslyVisible && card.fareKey == lastFareKey && now - lastEmitAt < SAME_CARD_WINDOW_MS
        if (card.signature != lastSignature && !isJitterOfSameCard) {
          emitCard(frame, card, lines)
          lastEmitAt = now
          lastFareKey = card.fareKey
        }
        lastSignature = card.signature
      } else if (lastSignature != null && now - lastCardSeenAt > CARD_GONE_MS) {
        lastSignature = null
        lastFareKey = null
      }

      updateState(if (card != null) "offer" else OfferDetector.classifyState(lines))
    } finally {
      try { frame.recycle() } catch (_: Throwable) {}
    }
  }

  fun close() {
    closed = true
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
      )
    )
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
  }
}
