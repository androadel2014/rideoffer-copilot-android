package com.rideoffercopilot.android

/** Only very likely offer cards: contextual app CTA + fare + leg units. */
object LiveOfferGate {
    fun looksLikeOffer(lines: List<OcrLine>): Boolean {
        if (lines.isEmpty()) return false
        val text = lines.joinToString("\n") { it.text }
        val app = OfferParser.detectPlatform(lines) ?: return false
        val callToAction = if (app == "Uber")
            Regex("\\b(?:Match|UberX|UberXL|Uber Green|Uber Comfort)\\b", RegexOption.IGNORE_CASE).containsMatchIn(text)
        else Regex("\\b(?:Accept|Incl\\.?|Lyft|Extra Comfort|Priority)\\b", RegexOption.IGNORE_CASE).containsMatchIn(text)
        if (!callToAction) return false
        if (!Regex("\\$\\s*\\d").containsMatchIn(text)) return false
        return lines.any { OfferParser.distanceAndMinutes(it.text) != null }
    }
}

