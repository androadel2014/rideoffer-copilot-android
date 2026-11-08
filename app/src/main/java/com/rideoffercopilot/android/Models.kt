package com.rideoffercopilot.android

import java.util.UUID

// Provisional defaults from the v1.1.1 iOS decision engine, NOT calibrated profitability advice.
data class DriverSettings(
    val greenDollarsPerMile: Double = 1.25,
    val greenDollarsPerHour: Double = 30.0,
    val redDollarsPerMile: Double = 0.90,
    val redDollarsPerHour: Double = 20.0,
    val runningCostPerMile: Double = 0.20,
    val longTripOneWayMiles: Double = 75.0,
    val deadZoneExtraMinutes: Double = 25.0,
    val deadZoneExtraMiles: Double = 8.0,
    val driverID: String = "driver-1",
    val voiceEnabled: Boolean = true,
    val uberEnabled: Boolean = true,
    val lyftEnabled: Boolean = true,
    val syncEnabled: Boolean = false,
    val syncServerBaseURL: String = "https://answerforu.com"
) {
    fun valid(): Boolean = listOf(greenDollarsPerMile, greenDollarsPerHour, redDollarsPerMile,
        redDollarsPerHour, runningCostPerMile, deadZoneExtraMiles, deadZoneExtraMinutes,
        longTripOneWayMiles).all { it.isFinite() && it >= 0.0 } &&
        greenDollarsPerMile >= redDollarsPerMile && greenDollarsPerHour >= redDollarsPerHour &&
        longTripOneWayMiles > 0 && driverID.isNotBlank() && driverID.length <= 128
}

data class OcrLine(val text: String, val y: Int, val height: Int = 0, val x: Int = 0)

data class OfferCandidate(
    val platform: String, val fare: Double, val tripMiles: Double, val tripMinutes: Double,
    val pickupMiles: Double? = null, val pickupMinutes: Double? = null,
    val riderRating: Double? = null, val surgeMultiplier: Double? = null,
    val surgeIncludedDollars: Double? = null, val pickupText: String? = null,
    val dropoffText: String? = null, val rawText: String = ""
)

data class OfferRecord(
    val id: String = UUID.randomUUID().toString().lowercase(),
    val timestamp: Long = System.currentTimeMillis(),
    val platform: String,
    val fare: Double,
    val tripMiles: Double,
    val tripMinutes: Double,
    val pickupMiles: Double?, val pickupMinutes: Double?,
    val riderRating: Double?, val surgeMultiplier: Double?, val surgeIncludedDollars: Double?,
    val netDollarsPerMile: Double, val netDollarsPerHour: Double, val netDollarsPerMinute: Double,
    val assumedPickupMissing: Boolean, val verdict: String,
    val outcome: String = "Pending", val outcomeTimestamp: Long? = null,
    val reasons: String, val pickupText: String?, val dropoffText: String?,
    val rawText: String, val extractionMethod: String = "pattern_scan",
    val driverID: String, val zoneTier: String,
    val deadZoneRepositionMiles: Double? = null, val deadZoneRepositionMinutes: Double? = null,
    val longTripReturnMiles: Double? = null, val longTripReturnMinutes: Double? = null,
    val effectiveMiles: Double? = null, val effectiveMinutes: Double? = null
) {
    val totalMiles: Double get() = tripMiles + (pickupMiles ?: 0.0)
    val totalMinutes: Double get() = tripMinutes + (pickupMinutes ?: 0.0)
}

data class WaitRecord(
    val id: String = UUID.randomUUID().toString().lowercase(),
    val driverID: String,
    val zoneText: String,
    val startedAt: Long,
    val durationSeconds: Double? = null,
    val endedBy: String? = null
)

data class ZoneConfig(
    val version: Int,
    val hot: List<String>,
    val neutral: List<String>,
    val dead: List<String>
)
