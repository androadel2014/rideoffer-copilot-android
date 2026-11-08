package com.rideoffercopilot.android

import java.util.Locale

object ZoneMatcher {
    // Unicode letter/digit boundaries: longest keyword first, dead wins equal-length ties.
    fun classify(dropoffText: String?, zones: ZoneConfig): String {
        if (dropoffText.isNullOrBlank()) return "neutral"
        var bestLength = -1
        var tier = "neutral"
        for ((group, keywords) in listOf("dead" to zones.dead, "hot" to zones.hot, "neutral" to zones.neutral)) {
            for (word in keywords) {
                val rx = Regex("(?<![\\p{L}\\p{N}])${Regex.escape(word)}(?![\\p{L}\\p{N}])", RegexOption.IGNORE_CASE)
                if (word.length > bestLength && rx.containsMatchIn(dropoffText)) {
                    bestLength = word.length
                    tier = group
                }
            }
        }
        return tier
    }
}

object DecisionEngine {
    fun decide(candidate: OfferCandidate, settings: DriverSettings, zones: ZoneConfig): OfferRecord? {
        if (!settings.valid() || !candidate.fare.isFinite() || candidate.fare <= 0 ||
            !candidate.tripMiles.isFinite() || candidate.tripMiles <= 0 ||
            !candidate.tripMinutes.isFinite() || candidate.tripMinutes <= 0 ||
            candidate.pickupMiles?.isFinite() == false || candidate.pickupMinutes?.isFinite() == false) return null
        val outwardDistance = candidate.tripMiles + maxOf(0.0, candidate.pickupMiles ?: 0.0)
        val outwardMinutes = candidate.tripMinutes + maxOf(0.0, candidate.pickupMinutes ?: 0.0)
        val long = candidate.tripMiles >= settings.longTripOneWayMiles
        val returnMiles = if (long) candidate.tripMiles else 0.0
        val returnMinutes = if (long) candidate.tripMinutes else 0.0
        val tier = ZoneMatcher.classify(candidate.dropoffText, zones)
        val dead = tier == "dead"
        val penaltyMiles = if (dead) settings.deadZoneExtraMiles else 0.0
        val penaltyMinutes = if (dead) settings.deadZoneExtraMinutes else 0.0
        val distance = outwardDistance + returnMiles + penaltyMiles
        val minutes = outwardMinutes + returnMinutes + penaltyMinutes
        if (distance <= 0 || minutes <= 0) return null
        val net = candidate.fare - settings.runningCostPerMile * distance
        val perMile = net / distance
        val perHour = net * 60.0 / minutes
        val incomplete = candidate.pickupMiles == null || candidate.pickupMinutes == null
        val verdict = when {
            perMile < settings.redDollarsPerMile || perHour < settings.redDollarsPerHour -> "red"
            perMile >= settings.greenDollarsPerMile && perHour >= settings.greenDollarsPerHour && !incomplete -> "green"
            else -> "yellow"
        }
        val reason = buildString {
            if (long) append("LONG TRIP - EMPTY RETURN ASSUMED. ")
            if (dead) append("DEAD-ZONE DROPOFF - reposition +${penaltyMinutes.toInt()} min / +${"%.1f".format(Locale.US, penaltyMiles)} mi. ")
            append(if (incomplete) "Pickup data incomplete; totals are estimates." else "Includes pickup and trip estimates.")
        }
        return OfferRecord(platform = candidate.platform, fare = candidate.fare,
            tripMiles = candidate.tripMiles, tripMinutes = candidate.tripMinutes,
            pickupMiles = candidate.pickupMiles, pickupMinutes = candidate.pickupMinutes,
            riderRating = candidate.riderRating, surgeMultiplier = candidate.surgeMultiplier,
            surgeIncludedDollars = candidate.surgeIncludedDollars,
            netDollarsPerMile = perMile, netDollarsPerHour = perHour,
            netDollarsPerMinute = perHour / 60.0, assumedPickupMissing = incomplete,
            verdict = verdict, reasons = reason,
            pickupText = candidate.pickupText, dropoffText = candidate.dropoffText,
            rawText = candidate.rawText, driverID = settings.driverID, zoneTier = tier,
            deadZoneRepositionMiles = if (dead) penaltyMiles else null,
            deadZoneRepositionMinutes = if (dead) penaltyMinutes else null,
            longTripReturnMiles = if (long || dead) returnMiles else null,
            longTripReturnMinutes = if (long || dead) returnMinutes else null,
            effectiveMiles = if (long || dead) distance else null,
            effectiveMinutes = if (long || dead) minutes else null)
    }
}
