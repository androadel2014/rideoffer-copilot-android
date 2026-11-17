package com.rideoffercopilot.screenwatcher

import android.graphics.Bitmap
import android.graphics.Rect

/**
 * vc13 fast path: finds a request card by its pixels in a few milliseconds, with no OCR.
 *
 * Uber and Lyft requests end in a wide, solid, strongly coloured Accept/Match button
 * (Uber: blue, two shades while the countdown fills it). Maps, text and the driver home
 * screen do not have a band like that: ≥ 70 % of the screen wide, 2–10 % of its height,
 * one saturated hue. Once the button is found, the card is the uniform panel above it.
 * Only that panel is OCR'd, once.
 *
 * Cards this does not recognise (other colours, dark themes without a coloured button)
 * still go through the vc12 full-frame path, so nothing is lost.
 */
internal object CardLocator {
  private const val SAMPLES = 21
  private const val MIN_SAT = 100 // max − min channel; map water/parks stay below this
  private const val MIN_MAX = 110
  private const val ROW_COVERAGE = 0.75f
  private const val HUE_TOL = 22f

  /** The lowest Accept-like button on screen, in bitmap coordinates, or null. */
  fun findAcceptButton(b: Bitmap, exclude: Rect?): Rect? {
    val w = b.width
    val h = b.height
    if (w < 50 || h < 100) return null
    val y0 = (h * 0.35f).toInt()
    val y1 = (h * 0.99f).toInt().coerceAtMost(h - 1)
    val step = (h / 500).coerceAtLeast(2)
    val row = IntArray(w)
    val xs = IntArray(SAMPLES) { ((0.15f + 0.70f * it / (SAMPLES - 1)) * w).toInt().coerceIn(0, w - 1) }
    val hues = FloatArray(SAMPLES)

    var best: Rect? = null
    var runTop = -1
    var runBottom = -1
    var runHue = 0f
    var gap = 0

    fun closeRun() {
      if (runTop >= 0) {
        val height = runBottom + step - runTop
        if (height >= h * 0.02f && height <= h * 0.10f) {
          val r = horizontalExtent(b, runTop, runBottom, runHue, row)
          if (r != null && r.width() >= w * 0.70f) best = r // keep the lowest one
        }
      }
      runTop = -1
      gap = 0
    }

    var y = y0
    while (y <= y1) {
      val excluded = exclude != null && y >= exclude.top && y <= exclude.bottom
      val rh = if (excluded) -1f else rowHue(b, y, row, xs, hues)
      if (rh >= 0f && (runTop < 0 || hueClose(rh, runHue))) {
        if (runTop < 0) {
          runTop = y
          runHue = rh
        }
        runBottom = y
        gap = 0
      } else if (runTop >= 0) {
        gap += step
        // Short breaks are the white "Accept" lettering crossing a sampled row.
        if (gap > step * 3) closeRun()
      }
      y += step
    }
    closeRun()
    return best
  }

  /**
   * The request card box above [button]: walks up the card's side margin (between the
   * card edge and the button edge) until the background stops being the card's own.
   * Falls back to a fixed-height box when the margin cannot be followed.
   */
  fun cardRegion(b: Bitmap, button: Rect): Rect {
    val w = b.width
    val h = b.height
    val fallbackTop = (button.top - h * 0.62f).toInt().coerceAtLeast(0)
    var top = fallbackTop
    val leftX = (button.left * 0.7f).toInt()
    val rightX = (button.right + (w - button.right) * 0.3f).toInt().coerceAtMost(w - 1)
    if (button.left >= 8 && w - button.right >= 8) {
      val startY = (button.top - 4).coerceAtLeast(1)
      val bgL = lum(b.getPixel(leftX, startY))
      val bgR = lum(b.getPixel(rightX, startY))
      val limit = (button.top - h * 0.75f).toInt().coerceAtLeast(0)
      var y = startY
      var off = 0
      var found = -1
      while (y > limit) {
        val inCard = Math.abs(lum(b.getPixel(leftX, y)) - bgL) <= 14 || Math.abs(lum(b.getPixel(rightX, y)) - bgR) <= 14
        if (inCard) {
          off = 0
        } else {
          off += 2
          // A divider line is a couple of pixels; the map above the card is not.
          if (off > 10) {
            found = y + off
            break
          }
        }
        y -= 2
      }
      if (found > 0 && button.top - found >= h * 0.12f) top = (found - 6).coerceAtLeast(0)
    }
    return Rect(0, top, w, (button.bottom + 6).coerceAtMost(h))
  }

  // --- helpers ----------------------------------------------------------------------------

  /** Median hue of a row when ≥ 75 % of the samples are one saturated colour; else −1. */
  private fun rowHue(b: Bitmap, y: Int, row: IntArray, xs: IntArray, hues: FloatArray): Float {
    b.getPixels(row, 0, b.width, 0, y, b.width, 1)
    var n = 0
    for (x in xs) {
      val c = row[x]
      val r = (c shr 16) and 0xFF
      val g = (c shr 8) and 0xFF
      val bl = c and 0xFF
      val mx = maxOf(r, g, bl)
      val mn = minOf(r, g, bl)
      if (mx >= MIN_MAX && mx - mn >= MIN_SAT) hues[n++] = hue(r, g, bl, mx, mn)
    }
    if (n < SAMPLES * ROW_COVERAGE) return -1f
    val sorted = hues.copyOf(n).also { it.sort() }
    val median = sorted[n / 2]
    var close = 0
    for (i in 0 until n) if (hueClose(sorted[i], median)) close++
    return if (close >= SAMPLES * ROW_COVERAGE) median else -1f
  }

  /** Left/right edges of the button on a row near its top (above the lettering). */
  private fun horizontalExtent(b: Bitmap, top: Int, bottom: Int, targetHue: Float, row: IntArray): Rect? {
    val y = (top + (bottom - top) / 5).coerceIn(0, b.height - 1)
    b.getPixels(row, 0, b.width, 0, y, b.width, 1)
    fun isButton(x: Int): Boolean {
      val c = row[x]
      val r = (c shr 16) and 0xFF
      val g = (c shr 8) and 0xFF
      val bl = c and 0xFF
      val mx = maxOf(r, g, bl)
      val mn = minOf(r, g, bl)
      return mx >= MIN_MAX && mx - mn >= MIN_SAT && hueClose(hue(r, g, bl, mx, mn), targetHue)
    }
    val mid = b.width / 2
    if (!isButton(mid) && !isButton((b.width * 0.3f).toInt())) return null
    var left = (b.width * 0.15f).toInt()
    while (left > 0 && isButton(left - 1)) left--
    var right = (b.width * 0.85f).toInt()
    while (right < b.width - 1 && isButton(right + 1)) right++
    return Rect(left, top, right + 1, bottom + 2)
  }

  private fun hue(r: Int, g: Int, b: Int, mx: Int, mn: Int): Float {
    val d = (mx - mn).toFloat()
    if (d <= 0f) return 0f
    val h = when (mx) {
      r -> ((g - b) / d) % 6f
      g -> (b - r) / d + 2f
      else -> (r - g) / d + 4f
    } * 60f
    return if (h < 0f) h + 360f else h
  }

  private fun hueClose(a: Float, b: Float): Boolean {
    val d = Math.abs(a - b)
    return minOf(d, 360f - d) <= HUE_TOL
  }

  private fun lum(c: Int): Int =
    (((c shr 16) and 0xFF) * 299 + ((c shr 8) and 0xFF) * 587 + (c and 0xFF) * 114) / 1000
}
