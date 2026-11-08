package com.rideoffercopilot.android

import kotlin.math.abs

/** OCR/text-only detector. No UI, accessibility, network or Android dependency.
 * A universal offer needs a fare AND two independent pieces of evidence:
 * distance, duration, and pickup/dropoff/address context.
 * Tuned brand markers select parsing behavior but do not bypass the evidence gate.
 */
object UniversalOfferDetector {
    private val currency = Regex("\\$\\s*([\\d,]+(?:\\.\\d{1,2})?)(?!\\d)")
    private val hourlyRate = Regex("(?:/\\s*(?:hr|hour|h)|per\\s*hour|hourly\\s*rate|est\\.?\\s*rate|\\$[\\d.]+\\s*/\\s*h)\\b", RegexOption.IGNORE_CASE)
    private val bonusOnly = Regex("\\b(?:tip(?:s)?|bonus|promo(?:tion)?|surge|incentive)\\b",RegexOption.IGNORE_CASE)
    private val distance = Regex("\\b(\\d+(?:\\.\\d+)?)\\s*(km|kilomet(?:er|re)s?|mi|miles?)\\b",RegexOption.IGNORE_CASE)
    private val hours = Regex("\\b(\\d+(?:\\.\\d+)?)\\s*(?:hr|hrs|hours?)\\b",RegexOption.IGNORE_CASE)
    private val minutes = Regex("\\b(\\d+(?:\\.\\d+)?)\\s*(?:min|mins|minutes?)\\b",RegexOption.IGNORE_CASE)
    private val locationLabel = Regex("\\b(?:pickup|pick\\s*up|pick-up|dropoff|drop\\s*off|drop-off|deliver(?:y)?\\s+to|pickup\\s+at|store\\s+location|station\\s+location)\\b",RegexOption.IGNORE_CASE)
    private val fareLabel = Regex("\\b(?:earn(?:ings)?|payout|pay|total|guaranteed|offer|est(?:imated)?\\.?\\s*earnings|base pay|batch pay)\\b",RegexOption.IGNORE_CASE)
    private val excludedTotal = Regex("\\b(?:subtotal|order total|cart total|purchase|checkout|tax|fee due|balance|you owe)\\b",RegexOption.IGNORE_CASE)
    private val nonOfferScreen = Regex("\\b(?:checkout|receipt|cart|groceries|navigation|directions|map)\\b",RegexOption.IGNORE_CASE)
    private val explicitOfferCue = Regex("\\b(?:offer|accept|match|earn|payout|deliver|delivery|batch|request|pickup|pick up|dropoff|drop off|block)\\b",RegexOption.IGNORE_CASE)
    private val dropLabel = Regex("\\b(?:dropoff|drop off|drop-off|delivery to|destination|deliver to)\\b",RegexOption.IGNORE_CASE)
    private val pickupLabel = Regex("\\b(?:pickup|pick up|pick-up|store pickup|station pickup)\\b",RegexOption.IGNORE_CASE)
    private val rating = Regex("[★☆]\\s*([1-5](?:\\.\\d+)?)")
    private val inclDollars = Regex("(?:\\+\\s*\\$\\s*([\\d,]+(?:\\.\\d+)?)\\s*included|\\bIncl\\.?\\s*\\$\\s*([\\d,]+(?:\\.\\d+)?)\\s*bonus)",RegexOption.IGNORE_CASE)
    private val surgeFactor = Regex("(?:[x×]\\s*(\\d+(?:\\.\\d+)?)|(\\d+(?:\\.\\d+)?)\\s*[x×])",RegexOption.IGNORE_CASE)

    /** Explicit adapter priorities for the four delivery product families. These are
     * text rules (not guessed screen coordinates), using a shared extraction/engine path.
     */
    private fun payoutScore(brand: String?, text: String): Int = when (brand) {
        "DoorDash" -> when {
            Regex("\\b(?:guaranteed|earn|this offer|offer amount)\\b",RegexOption.IGNORE_CASE).containsMatchIn(text)->30
            else->0
        }
        "Instacart" -> when {
            Regex("\\b(?:batch total|total earnings|estimated earnings)\\b",RegexOption.IGNORE_CASE).containsMatchIn(text)->30
            else->0
        }
        "Amazon Flex" -> when {
            Regex("\\b(?:block pay|offer pay|earnings)\\b",RegexOption.IGNORE_CASE).containsMatchIn(text)->30
            else->0
        }
        "Walmart Spark" -> when {
            Regex("\\b(?:estimated earnings|est\\.|trip earnings|offer pay)\\b",RegexOption.IGNORE_CASE).containsMatchIn(text)->30
            else->0
        }
        else->0
    }

    private fun routeScore(brand: String?, text: String): Int = when(brand) {
        "DoorDash" -> if(Regex("\\b(?:total distance|delivery distance|route miles)\\b",RegexOption.IGNORE_CASE).containsMatchIn(text)) 20 else 0
        "Instacart" -> if(Regex("\\b(?:driving distance|delivery miles|total driving)\\b",RegexOption.IGNORE_CASE).containsMatchIn(text)) 20 else 0
        "Walmart Spark" -> if(Regex("\\b(?:trip distance|delivery distance|total miles)\\b",RegexOption.IGNORE_CASE).containsMatchIn(text)) 20 else 0
        else->0
    }
    private fun durationScore(brand: String?, text: String): Int = when(brand) {
        "Amazon Flex" -> if(Regex("\\b(?:block|duration|scheduled)\\b",RegexOption.IGNORE_CASE).containsMatchIn(text)) 20 else 0
        "Instacart" -> if(Regex("\\b(?:estimated time|batch time|total time)\\b",RegexOption.IGNORE_CASE).containsMatchIn(text)) 20 else 0
        "DoorDash", "Walmart Spark" -> if(Regex("\\b(?:estimated|total|time)\\b",RegexOption.IGNORE_CASE).containsMatchIn(text)) 20 else 0
        else->0
    }

    data class PartialOffer(
        val platform: String,
        val fare: Double,
        val miles: Double?,
        val minutes: Double?,
        val pickupText: String?,
        val dropoffText: String?,
        val rawText: String
    )

    data class Detected(
        val platform: String, // source package label in live capture, OCR brand for manual import
        val candidate: OfferCandidate? = null,
        val partial: PartialOffer? = null,
        val parser: String
    ) {
        val fare: Double get() = candidate?.fare ?: requireNotNull(partial).fare
        fun fingerprintCandidate(): OfferCandidate = candidate ?: requireNotNull(partial).let {
            // The 0s are *only* internal dedup keys; the record's unknown numeric fields are serialized as JSON null.
            OfferCandidate(platform, it.fare, it.miles ?: 0.0, it.minutes ?: 0.0,
                pickupText=it.pickupText,dropoffText=it.dropoffText)
        }
    }

    fun evidence(lines: List<OcrLine>): Int {
        val text = lines.joinToString("\n") { it.text }
        return (if (distance.containsMatchIn(text)) 1 else 0) +
            (if (lines.any { duration(it.text) != null }) 1 else 0) +
            (if (lines.any { locationLabel.containsMatchIn(it.text) || CardPrivacy.looksLikeAddress(it.text) }) 1 else 0)
    }

    fun looksLikeOffer(lines: List<OcrLine>): Boolean {
        val text=lines.joinToString("\n") { it.text }
        // A map/checkout with unrelated prices and ETA text is not an active work offer.
        if(nonOfferScreen.containsMatchIn(text) && !explicitOfferCue.containsMatchIn(text)) return false
        return lines.any { fareValue(it.text) != null } && evidence(lines) >= 2
    }

    private fun fareValue(s: String): Double? {
        if (hourlyRate.containsMatchIn(s) || excludedTotal.containsMatchIn(s)) return null
        if (bonusOnly.containsMatchIn(s) && !fareLabel.containsMatchIn(s) && !s.trimStart().startsWith("$")) return null
        val amount = currency.find(s)?.groupValues?.get(1)?.replace(",", "")?.toDoubleOrNull()
        return amount?.takeIf { it.isFinite() && it > 0 && it < 100_000 }
    }

    private fun duration(s: String): Double? {
        // A quoted dollars-per-hour rate is NOT the time required for this delivery.
        if (hourlyRate.containsMatchIn(s)) return null
        val h = hours.find(s)?.groupValues?.get(1)?.toDoubleOrNull()
        val m = minutes.find(s)?.groupValues?.get(1)?.toDoubleOrNull()
        if (h == null && m == null) return null
        return ((h ?: 0.0) * 60 + (m ?: 0.0)).takeIf {it.isFinite() && it > 0}
    }

    private fun miles(s: String): Double? {
        val match = distance.find(s) ?: return null
        val n = match.groupValues[1].toDoubleOrNull() ?: return null
        if (!n.isFinite() || n <= 0) return null
        return n * if (match.groupValues[2].lowercase().startsWith("k")) 0.62137119223733 else 1.0
    }

    /** Brand-specific OCR markers. Package detection is separate: image text cannot prove which app owns the screen. */
    fun brandOf(lines: List<OcrLine>): String? {
        val text=lines.joinToString("\n") { it.text }
        // Explicit delivery-brand text outranks generic "Accept" (also seen on Lyft).
        val brands=listOf(
            "DoorDash" to Regex("\\b(?:DoorDash|Dasher|Dash Now|Dash offer)\\b",RegexOption.IGNORE_CASE),
            "Instacart" to Regex("\\b(?:Instacart|Shopper|Batch offer|Shop & Deliver)\\b",RegexOption.IGNORE_CASE),
            "Amazon Flex" to Regex("\\b(?:Amazon Flex|Flex block|Available blocks|Block offer)\\b",RegexOption.IGNORE_CASE),
            "Walmart Spark" to Regex("\\b(?:Spark Driver|Walmart Spark|Spark offer|Shopping & Delivery)\\b",RegexOption.IGNORE_CASE)
        )
        return brands.firstOrNull {it.second.containsMatchIn(text)}?.first
            ?: OfferParser.detectPlatform(lines)
    }

    /** Look around each fare anchor rather than joining unrelated map/navigation text elsewhere on the display.
     * frameHeight should be the real captured frame height, zero for artificial OCR fixtures.
     */
    fun detect(
        allLines: List<OcrLine>,
        sourceLabel: String? = null,
        sourcePackage: String? = null,
        frameHeight: Int = 0
    ): Detected? {
        val sorted=allLines.sortedWith(compareBy<OcrLine> { it.y }.thenBy {it.x})
        val detectedBrand=SourceAppNames.knownName(sourcePackage) ?: brandOf(sorted)
        val anchors=sorted.filter { fareValue(it.text) != null }.sortedWith(
            compareByDescending<OcrLine> { it.height + payoutScore(detectedBrand,it.text) + if(fareLabel.containsMatchIn(it.text)) 8 else 0 }
                .thenBy {it.y})
        if (anchors.isEmpty()) return null
        val maxSpan=if(frameHeight>0) (frameHeight*0.49).toInt().coerceAtLeast(360) else 700
        for (anchor in anchors) {
            val card=sorted.filter { abs(it.y-anchor.y)<=maxSpan }
            if (!looksLikeOffer(card)) continue
            val ocrBrand=brandOf(card) ?: brandOf(sorted)
            val sourceBrand=SourceAppNames.knownName(sourcePackage)
            val extractionBrand=sourceBrand ?: ocrBrand
            val label=sourceLabel?.takeIf {it.isNotBlank()} ?: sourceBrand ?: ocrBrand ?: "Unknown app"
            if (extractionBrand=="Uber" || extractionBrand=="Lyft") {
                val tuned=OfferParser.scan(card, extractionBrand)
                if(tuned!=null) return Detected(label,candidate=tuned.copy(platform=label),parser="tuned_${extractionBrand.lowercase().replace(" ","_")}")
            }
            val fareLine=card.filter {fareValue(it.text)!=null}.sortedWith(
                compareByDescending<OcrLine> {it.height + payoutScore(extractionBrand,it.text) + if(fareLabel.containsMatchIn(it.text)) 8 else 0}.thenBy {it.y}).firstOrNull() ?: continue
            val fare=fareValue(fareLine.text) ?: continue
            // Remove repeated summary mileage/duration if it is a sum of two legs (Uber style).
            val possible=card.mapIndexedNotNull {i,line ->
                val d=miles(line.text)
                val t=duration(line.text)
                if(d!=null && t!=null) Triple(i,d,t) else null
            }
            val nonSummary=possible.filter {s -> possible.none {a->a.first!=s.first && possible.any {b ->
                b.first!=s.first && b.first!=a.first && s.second>a.second && s.second>b.second &&
                    abs(a.second+b.second-s.second)<=1.0 && abs(a.third+b.third-s.third)<=4.0
            }}}
            val tripPair=nonSummary.maxByOrNull {it.third}
            // Prefer the leg with the larger time as the service leg, not the pickup leg.
            var tripMiles=tripPair?.second
            var tripMinutes=tripPair?.third
            if (tripMiles==null) {
                val route=card.filter {miles(it.text)!=null && !pickupLabel.containsMatchIn(it.text)}
                    .maxWithOrNull(compareBy<OcrLine> {routeScore(extractionBrand,it.text)}.thenBy {it.height})
                    ?: card.firstOrNull {miles(it.text)!=null}
                tripMiles=route?.let {miles(it.text)}
            }
            if (tripMinutes==null) {
                val service=card.filter {duration(it.text)!=null && !pickupLabel.containsMatchIn(it.text)}
                    .maxWithOrNull(compareBy<OcrLine> {durationScore(extractionBrand,it.text)}.thenBy {it.height})
                tripMinutes=service?.let {duration(it.text)}
            }
            val pLine=card.firstOrNull {pickupLabel.containsMatchIn(it.text) && miles(it.text)!=null && duration(it.text)!=null}
            val pickupMiles=pLine?.let {miles(it.text)}
            val pickupMinutes=pLine?.let {duration(it.text)}
            // If a two-leg card was read, don't attribute pickup miles/time as the service leg.
            val locationLines=card.filter { CardPrivacy.looksLikeAddress(it.text) }
            val pickupAddress=card.indexOfFirst {pickupLabel.containsMatchIn(it.text)}.takeIf {it>=0}?.let {index ->
                card.drop(index).take(4).firstOrNull {CardPrivacy.looksLikeAddress(it.text)}?.text
            }
            val dropAddress=card.indexOfFirst {dropLabel.containsMatchIn(it.text)}.takeIf {it>=0}?.let {index ->
                card.drop(index).take(4).firstOrNull {CardPrivacy.looksLikeAddress(it.text)}?.text
            } ?: locationLines.lastOrNull()?.text
            val ratingFound=rating.find(card.joinToString("\n") {it.text})?.groupValues?.get(1)?.toDoubleOrNull()
            val included=inclDollars.find(card.joinToString("\n"){it.text})?.groupValues?.drop(1)?.firstOrNull {it.isNotEmpty()}?.replace(",", "")?.toDoubleOrNull()
            val multiplier=surgeFactor.find(card.joinToString("\n"){it.text})?.groupValues?.drop(1)?.firstOrNull {it.isNotEmpty()}?.toDoubleOrNull()
            val sanitized=CardPrivacy.sanitize(card)
            if (tripMiles!=null && tripMinutes!=null && tripMiles>0 && tripMinutes>0) {
                return Detected(label,OfferCandidate(label,fare,tripMiles,tripMinutes,pickupMiles,pickupMinutes,
                    ratingFound,multiplier,included,pickupAddress,dropAddress,sanitized),parser="${extractionBrand?.lowercase()?.replace(" ","_") ?: "generic"}_complete")
            }
            val partial=PartialOffer(label,fare,tripMiles,tripMinutes,pickupAddress,dropAddress,sanitized)
            return Detected(label,partial=partial,parser="${extractionBrand?.lowercase()?.replace(" ","_") ?: "generic"}_partial")
        }
        return null
    }
}

/** Only source-package names are authoritative for *live* History labels. */
object SourceAppNames {
    private val known = mapOf(
        "com.ubercab.driver" to "Uber", "com.lyft.android.driver" to "Lyft",
        "com.doordash.driverapp" to "DoorDash", "com.instacart.shopper" to "Instacart",
        "com.amazon.flex.rabbit" to "Amazon Flex", "com.walmart.sparkdriver" to "Walmart Spark"
    )
    fun knownName(packageName: String?): String? = known[packageName?.lowercase()]
}

/** Separate partial-delivery pathway; it NEVER feeds fabricated miles/time to DecisionEngine.
 * A gross hourly estimate (when time exists) is not NET and is never marked ACCEPT.
 */
object PartialDeliveryGrader {
    fun grade(partial: UniversalOfferDetector.PartialOffer, settings: DriverSettings, zones: ZoneConfig): OfferRecord? {
        if (!settings.valid() || !partial.fare.isFinite() || partial.fare<=0) return null
        val miles=partial.miles?.takeIf {it.isFinite() && it>0}
        val minutes=partial.minutes?.takeIf {it.isFinite() && it>0}
        val grossHourly=minutes?.let{partial.fare*60.0/it}
        val tier=ZoneMatcher.classify(partial.dropoffText,zones)
        val reason=buildString {
            append("INCOMPLETE DELIVERY CARD - no NET rates calculated; ")
            if (miles==null) append("route distance unavailable. ")
            if (minutes==null) append("duration unavailable. ")
            if (grossHourly!=null) append("Gross hourly estimate excludes unknown operating costs. ")
            if (miles!=null && miles>=settings.longTripOneWayMiles) append("LONG TRIP - empty return may apply; full time not known. ")
            if (tier=="dead") append("DEAD-ZONE DROPOFF - reposition risk; effective grade unavailable. ")
            append("Review original card before accepting.")
        }
        return OfferRecord(platform=partial.platform,fare=partial.fare,tripMiles=miles?:0.0,tripMinutes=minutes?:0.0,
            pickupMiles=null,pickupMinutes=null,riderRating=null,surgeMultiplier=null,surgeIncludedDollars=null,
            netDollarsPerMile=0.0,netDollarsPerHour=0.0,netDollarsPerMinute=0.0,assumedPickupMissing=true,
            verdict="yellow",reasons=reason,pickupText=partial.pickupText,dropoffText=partial.dropoffText,
            rawText=partial.rawText,driverID=settings.driverID,zoneTier=tier,metricMode=if(grossHourly!=null)"gross_hour_estimate" else "per_delivery",
            hasTripMiles=miles!=null,hasTripMinutes=minutes!=null,grossHourlyEstimate=grossHourly)
    }
}
