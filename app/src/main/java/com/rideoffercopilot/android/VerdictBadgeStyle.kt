package com.rideoffercopilot.android

/** Tested independently from Android UI. Do not collapse yellow into red. */
data class BadgeStyle(val title: String, val argb: Int)
object VerdictBadgeStyle {
    fun forVerdict(verdict: String): BadgeStyle = when(verdict) {
        "green" -> BadgeStyle("ACCEPT", 0xFF167840.toInt())
        "yellow" -> BadgeStyle("BORDERLINE", 0xFFC28A11.toInt())
        "red" -> BadgeStyle("SKIP", 0xFFAC2334.toInt())
        else -> BadgeStyle("REVIEW", 0xFF555555.toInt())
    }
}
