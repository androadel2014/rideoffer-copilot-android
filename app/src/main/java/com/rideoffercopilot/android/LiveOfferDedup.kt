package com.rideoffercopilot.android

import kotlin.math.roundToLong

/** Pure Kotlin session filter. One offer is recorded once while its card remains visible.
 * An OCR dropout does not create a second entry. After a cooldown, a genuinely later
 * offer with identical numeric details can be recorded again.
 */
class LiveOfferDedup(private val cooldownMillis: Long = 90_000L) {
    private val recent = mutableMapOf<String, Long>()
    private var activeKey: String? = null
    private var missingFrames = 0
    private var lastSeenAt = Long.MIN_VALUE

    fun shouldLog(offer: OfferCandidate, nowMillis: Long): Boolean {
        val key = fingerprint(offer)
        missingFrames = 0
        // As long as consecutive frames show the card, the offer is the same.
        // A >cooldown gap without observations permits a genuinely later identical card.
        if (activeKey == key && nowMillis >= lastSeenAt && nowMillis - lastSeenAt < cooldownMillis) {
            lastSeenAt = nowMillis
            return false
        }
        activeKey = key
        lastSeenAt = nowMillis
        val last = recent[key]
        recent[key] = nowMillis
        recent.entries.removeAll { nowMillis - it.value > cooldownMillis * 3 }
        return last == null || nowMillis - last >= cooldownMillis
    }

    /** Called after no valid offer is recognized; tolerate transient OCR misses. */
    fun onNoOffer() {
        missingFrames++
        if (missingFrames >= 3) activeKey = null
    }

    fun reset() { activeKey = null; missingFrames = 0; lastSeenAt = Long.MIN_VALUE; recent.clear() }

    fun fingerprint(o: OfferCandidate): String = listOf(
        o.platform.lowercase(), (o.fare * 100).roundToLong(),
        (o.tripMiles * 10).roundToLong(), o.tripMinutes.roundToLong(),
        ( (o.pickupMiles ?: -1.0) * 10).roundToLong(), (o.pickupMinutes ?: -1.0).roundToLong(),
        (o.dropoffText ?: "").trim().lowercase().replace(Regex("\\s+")," ")
    ).joinToString("|")
}
