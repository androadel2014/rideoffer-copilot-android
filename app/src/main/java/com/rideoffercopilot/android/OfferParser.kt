package com.rideoffercopilot.android

import kotlin.math.abs

object CardPrivacy {
    private val addressStreet = Regex("\\b(?:St|Street|Rd|Road|Ln|Lane|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Pkwy|Parkway|Ct|Court|Hwy|Highway|Pl|Place)\\b", RegexOption.IGNORE_CASE)
    private val addressPlace = Regex("\\b(?:Washington|Arlington|Alexandria|Bethesda|Vienna|Tysons|Fairfax|McLean|NYC|Maryland|Virginia|DC|VA|MD)\\b", RegexOption.IGNORE_CASE)
    private val moneyOrTime = Regex("\\$\\s*\\d|\\b\\d+(?:\\.\\d+)?\\s*(?:mi|miles?|min|mins?|hr|hrs?|hours?)\\b", RegexOption.IGNORE_CASE)
    private val label = Regex("^(?:uber(?:x|xl| green| comfort)?|lyft|comfort|extra comfort|match|accept|dismiss|exclusive|request|verified|tolls paid|pick\\s*up|drop\\s*off|included bonus|incl\\.?)\\b", RegexOption.IGNORE_CASE)
    private val rating = Regex("[★☆]\\s*[1-5](?:\\.\\d+)?|\\b(?:rating|verified)\\b\\s*[★☆]?\\s*[1-5](?:\\.\\d+)?", RegexOption.IGNORE_CASE)
    private val marker = Regex("\\b(?:verified|rating)\\b|[★☆]", RegexOption.IGNORE_CASE)
    private val milesMin = Regex("\\bmi(?:les)?\\b|\\bmin\\b", RegexOption.IGNORE_CASE)
    private val labelThenPossibleName = Regex("^(?:pick\\s*up|drop\\s*off|uber(?:x|xl| green| comfort)?|lyft|comfort|extra comfort|match|accept|request)\\b",RegexOption.IGNORE_CASE)

    fun looksLikeAddress(value: String): Boolean {
        val t = value.trim()
        // A surname that happens to equal "Lane"/"Street" isn't enough evidence of an address.
        // Require a street signal PLUS an address context, or a known place with punctuation/digits.
        val streetWithContext = addressStreet.containsMatchIn(t) &&
            (t.any(Char::isDigit) || t.contains(" & ") ||
             (t.contains(",") && addressPlace.containsMatchIn(t)))
        val placeWithContext = addressPlace.containsMatchIn(t) &&
            (t.contains(",") || t.contains(" & ") || t.any(Char::isDigit))
        return streetWithContext || placeWithContext
    }

    /** Allow-list only. Unrecognized lines (including isolated rider names) are discarded. */
    fun sanitize(lines: List<OcrLine>): String = lines.sortedWith(compareBy<OcrLine> { it.y }.thenBy { it.x })
        .mapNotNull { source ->
            var t = source.text.trim()
            if (t.isEmpty()) return@mapNotNull null
            val hit = marker.find(t)
            if (hit != null && hit.range.first > 0 && !looksLikeAddress(t) &&
                !t.contains('$') && !milesMin.containsMatchIn(t)) {
                t = t.substring(hit.range.first)
            }
            // A label can be followed by a rider name. Do not allow such free-form words:
            // without an address/rating/number, persist only the known action/product label.
            if (!looksLikeAddress(t) && !moneyOrTime.containsMatchIn(t) && !rating.containsMatchIn(t)) {
                val action=labelThenPossibleName.find(t)
                if(action!=null) t=action.value
            }
            // Currency preceded by unknown text is not trusted as a name. Strip prefix.
            if (t.contains('$') && !looksLikeAddress(t) && !label.containsMatchIn(t)) {
                val p = t.indexOf('$')
                if (p > 0 && t.substring(0, p).trim().matches(Regex("[\\p{L}\\s]+"))) t = t.substring(p)
            }
            t.takeIf { moneyOrTime.containsMatchIn(it) || label.containsMatchIn(it) ||
                rating.containsMatchIn(it) || looksLikeAddress(it) }
        }.joinToString("\n")
}

object OfferParser {
    private val currencyLeading = Regex("^\\s*\\$\\s*([\\d,]+(?:\\.\\d{1,2})?)(?!\\d)")
    private val hourly = Regex("/\\s*hr|per\\s*hour|est\\.?\\s*rate|bonus\\s*only", RegexOption.IGNORE_CASE)
    private val miles = Regex("\\b(\\d+(?:\\.\\d+)?)\\s*(?:mi|miles?)\\b", RegexOption.IGNORE_CASE)
    private val hours = Regex("\\b(\\d+)\\s*(?:hr|hrs|hours?)\\b", RegexOption.IGNORE_CASE)
    private val minutes = Regex("\\b(\\d+(?:\\.\\d+)?)\\s*(?:min|mins|minutes?)\\b", RegexOption.IGNORE_CASE)
    private val ratingStar = Regex("[★☆]\\s*([1-5](?:\\.\\d+)?)")
    private val ratingLabel = Regex("\\b(?:rating|verified)\\b\\s*[★☆]?\\s*([1-5](?:\\.\\d+)?)", RegexOption.IGNORE_CASE)
    private val includedPlus = Regex("\\+\\s*\\$\\s*([\\d,]+(?:\\.\\d+)?)\\s*included", RegexOption.IGNORE_CASE)
    private val includedBonus = Regex("\\bIncl\\.?\\s*\\$\\s*([\\d,]+(?:\\.\\d+)?)\\s*bonus", RegexOption.IGNORE_CASE)
    private val surgeFactor = Regex("(?:[x×]\\s*(\\d+(?:\\.\\d+)?)|(\\d+(?:\\.\\d+)?)\\s*[x×])", RegexOption.IGNORE_CASE)
    private val pickupLabel = Regex("\\b(?:pickup|pick up|to pickup)\\b", RegexOption.IGNORE_CASE)
    private val dropLabel = Regex("\\b(?:dropoff|drop off|trip|ride leg)\\b", RegexOption.IGNORE_CASE)

    data class Leg(val miles: Double, val minutes: Double, val position: Int,
                   val context: String, val address: String?)

    fun distanceAndMinutes(text: String): Pair<Double, Double>? {
        val mi = miles.find(text)?.groupValues?.get(1)?.toDoubleOrNull() ?: return null
        val hr = hours.find(text)?.groupValues?.get(1)?.toDoubleOrNull() ?: 0.0
        val min = minutes.find(text)?.groupValues?.get(1)?.toDoubleOrNull()
        if (hr == 0.0 && min == null) return null
        return mi to (hr * 60 + (min ?: 0.0))
    }

    fun detectPlatform(lines: List<OcrLine>): String? {
        val all = lines.joinToString("\n") { it.text }
        var uber = 0
        var lyft = 0
        // Card-specific markers deliberately outrank navigation/status-bar app names.
        if (Regex("\\bUber(?:X|XL| Green| Comfort)\\b", RegexOption.IGNORE_CASE).containsMatchIn(all)) uber += 10
        if (Regex("\\bMatch\\b", RegexOption.IGNORE_CASE).containsMatchIn(all)) uber += 7
        if (Regex("\\bUber\\b", RegexOption.IGNORE_CASE).containsMatchIn(all)) uber += 1
        if (Regex("\\bIncl\\.?\\s*\\$|\\bIncl\\.?\\s*bonus", RegexOption.IGNORE_CASE).containsMatchIn(all)) lyft += 8
        if (Regex("\\bAccept\\b", RegexOption.IGNORE_CASE).containsMatchIn(all)) lyft += 6
        if (Regex("\\b(?:Extra Comfort|Comfort|Priority)\\b", RegexOption.IGNORE_CASE).containsMatchIn(all)) lyft += 3
        if (Regex("\\bLyft\\b", RegexOption.IGNORE_CASE).containsMatchIn(all)) lyft += 1
        return when {
            uber == 0 && lyft == 0 -> null
            uber > lyft -> "Uber"
            lyft > uber -> "Lyft"
            else -> null // ambiguous: never silently assign a platform
        }
    }

    fun scan(input: List<OcrLine>, platformOverride: String? = null): OfferCandidate? {
        val lines = input.sortedWith(compareBy<OcrLine> { it.y }.thenBy { it.x })
        val platform = platformOverride ?: detectPlatform(lines) ?: return null
        val fareLines = lines.mapNotNull { line ->
            if (hourly.containsMatchIn(line.text)) return@mapNotNull null
            val found = currencyLeading.find(line.text) ?: return@mapNotNull null
            val amount = found.groupValues[1].replace(",", "").toDoubleOrNull() ?: return@mapNotNull null
            if (!amount.isFinite() || amount <= 0) null else line to amount
        }
        // Largest-text leading currency amount; tie goes to the first line onscreen.
        val fare = fareLines.withIndex().sortedWith(compareByDescending<IndexedValue<Pair<OcrLine, Double>>> { it.value.first.height }
            .thenBy { it.index }).firstOrNull()?.value?.second ?: return null
        val foundLegs = lines.mapIndexedNotNull { i, line ->
            val pair = distanceAndMinutes(line.text) ?: return@mapIndexedNotNull null
            val address = lines.drop(i + 1).take(3).firstOrNull { CardPrivacy.looksLikeAddress(it.text) }?.text
            val context = (lines.getOrNull(i - 1)?.text ?: "") + " " + line.text
            Leg(pair.first, pair.second, i, context, address)
        }
        val legs = foundLegs.filter { summary ->
            foundLegs.none { a ->
                a.position != summary.position && foundLegs.any { b ->
                    b.position != a.position && b.position != summary.position &&
                        abs((a.miles + b.miles) - summary.miles) <= 1.0 &&
                        abs((a.minutes + b.minutes) - summary.minutes) <= 4.0 &&
                        summary.miles > a.miles && summary.miles > b.miles
                }
            }
        }
        if (legs.isEmpty()) return null
        var pickup: Leg? = legs.firstOrNull { pickupLabel.containsMatchIn(it.context) }
        var trip: Leg? = legs.firstOrNull { dropLabel.containsMatchIn(it.context) && it != pickup }
        if (legs.size == 1) { pickup = null; trip = legs.first() }
        else if (pickup == null && trip == null) {
            // Prefer the earlier of the two smaller/shorter legs for pickup.
            pickup = legs.sortedWith(compareBy<Leg> { it.minutes }.thenBy { it.position }).first()
            val pickupIndex = pickup.position
            trip = legs.firstOrNull { it.position != pickupIndex }
        } else if (pickup == null) pickup = legs.firstOrNull { it.position != trip?.position }
        else if (trip == null) {
            val pickupIndex = pickup?.position
            trip = legs.firstOrNull { it.position != pickupIndex }
        }
        val ride = trip ?: return null
        if (ride.minutes <= 0 || ride.miles <= 0) return null
        val combined = lines.joinToString("\n") { it.text }
        val rating = (ratingStar.find(combined) ?: ratingLabel.find(combined))?.groupValues?.get(1)?.toDoubleOrNull()
        val bonus = (includedPlus.find(combined) ?: includedBonus.find(combined))?.groupValues?.get(1)?.replace(",", "")?.toDoubleOrNull()
        val multiplier = surgeFactor.find(combined)?.groupValues?.drop(1)?.firstOrNull { it.isNotEmpty() }?.toDoubleOrNull()
        return OfferCandidate(platform, fare, ride.miles, ride.minutes,
            pickup?.miles, pickup?.minutes, rating, multiplier, bonus,
            pickup?.address?.takeIf { CardPrivacy.looksLikeAddress(it) },
            ride.address?.takeIf { CardPrivacy.looksLikeAddress(it) }, CardPrivacy.sanitize(lines))
    }
}
