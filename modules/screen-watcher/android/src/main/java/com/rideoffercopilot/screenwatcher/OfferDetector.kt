package com.rideoffercopilot.screenwatcher

import android.graphics.Rect

internal data class OcrLine(val text: String, val rect: Rect)

internal data class DetectedCard(val rect: Rect, val signature: String, val fareKey: String)

/**
 * Cheap, text-only detector that decides whether the current frame shows a ride-offer
 * card and where it is. It never extracts fields — parsing and grading happen in the
 * TypeScript engine (src/ocr, src/engine) so they can be unit-tested and tuned.
 *
 * An offer card is: a headline dollar amount + at least one "N min … N.N mi" metric,
 * plus either an Accept/Match button or a second metric line (pickup + trip).
 */
internal object OfferDetector {
  private val FARE = Regex("""(?:\$|(?<![A-Za-z])S)\s?\d{1,3}[.,]\d{2}""")
  private val MIN = Regex("""\b\d{1,3}\s*(?:min|mins|minutes)\b""", RegexOption.IGNORE_CASE)
  private val HOUR = Regex("""\b\d{1,2}\s*(?:hr|hrs|h)\b""", RegexOption.IGNORE_CASE)
  private val MI = Regex("""\b\d{1,3}(?:[.,]\d{1,2})?\s*(?:mi|miles?)\b""", RegexOption.IGNORE_CASE)
  private val ACCEPT = Regex("""\b(accept|match|tap to accept)\b""", RegexOption.IGNORE_CASE)

  private val TRIP_WORDS = listOf(
    "complete trip", "complete uber", "complete lyft", "start uber", "start trip", "start ride",
    "swipe to start", "swipe to complete", "drop off", "dropping off", "drop-off", "picking up",
    "you've arrived", "you’ve arrived", "waiting for rider", "rider notified", "end ride",
    "confirm arrival", "arrived at pickup", "heading to"
  )
  private val IDLE_WORDS = listOf(
    "you're online", "you’re online", "finding trips", "finding rides", "looking for rides",
    "looking for trips", "go offline", "you're offline", "you’re offline", "go online",
    "waiting for requests", "searching for riders", "finding requests"
  )

  private fun isTimeLike(t: String) = MIN.containsMatchIn(t) || HOUR.containsMatchIn(t)

  private fun metricLines(lines: List<OcrLine>): List<OcrLine> {
    val out = ArrayList<OcrLine>()
    for (l in lines) {
      val hasTime = isTimeLike(l.text)
      val hasMi = MI.containsMatchIn(l.text)
      if (hasTime && hasMi) {
        out.add(l)
      } else if (hasTime || hasMi) {
        // "4 min" and "(1.2 mi)" recognized as separate lines on the same row.
        val partner = lines.firstOrNull { o ->
          o !== l && Math.abs(o.rect.centerY() - l.rect.centerY()) < l.rect.height() &&
            (if (hasTime) MI.containsMatchIn(o.text) else isTimeLike(o.text))
        }
        if (partner != null && out.none { it.rect.centerY() == partner.rect.centerY() }) out.add(l)
      }
    }
    return out
  }

  fun detect(lines: List<OcrLine>, width: Int, height: Int): DetectedCard? {
    if (lines.isEmpty() || width <= 0 || height <= 0) return null
    val fares = lines.filter { FARE.containsMatchIn(it.text) }
    if (fares.isEmpty()) return null
    val metrics = metricLines(lines)
    if (metrics.isEmpty()) return null

    val fare = fares.maxByOrNull { it.rect.height() } ?: return null
    val accept = lines
      .filter { ACCEPT.containsMatchIn(it.text) && it.rect.top >= fare.rect.top }
      .maxByOrNull { it.rect.bottom }
    if (accept == null && metrics.size < 2) return null

    val lh = fare.rect.height().coerceAtLeast(16)
    val metricTop = metrics.minOf { it.rect.top }
    val metricBottom = metrics.maxOf { it.rect.bottom }
    var top = minOf(fare.rect.top - (lh * 2.5f).toInt(), metricTop - lh)
    var bottom = maxOf(accept?.rect?.bottom ?: 0, metricBottom + lh * 3)
    top = top.coerceIn(0, height - 2)
    bottom = bottom.coerceIn(top + 1, height)
    if (bottom - top < height * 0.08f) return null

    val fareKey = digits(fare.text)
    val signature = fareKey + "|" + metrics.joinToString(",") { digits(it.text) }
    return DetectedCard(Rect(0, top, width, bottom), signature, fareKey)
  }

  fun classifyState(lines: List<OcrLine>): String {
    if (lines.isEmpty()) return "other"
    val text = lines.joinToString(" ") { it.text }.lowercase()
    if (TRIP_WORDS.any { text.contains(it) }) return "trip"
    if (IDLE_WORDS.any { text.contains(it) }) return "idle"
    return "other"
  }

  private fun digits(s: String): String = s.filter { it.isDigit() || it == '.' }
}
