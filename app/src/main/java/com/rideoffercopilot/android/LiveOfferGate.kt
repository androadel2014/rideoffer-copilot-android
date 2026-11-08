package com.rideoffercopilot.android

/** Money + at least two independent signals (distance, duration, address/leg label).
 * The full card's parser then separates trip offers and incomplete delivery offers.
 */
object LiveOfferGate {
    fun looksLikeOffer(lines: List<OcrLine>): Boolean = UniversalOfferDetector.looksLikeOffer(lines)
}
