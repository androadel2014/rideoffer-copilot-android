package com.rideoffercopilot.android

import org.junit.Assert.*
import org.junit.Test

/** OCR transcripts are synthetic layout examples, not claims about current vendor UX. */
class GenericOfferTests {
    private fun lines(name: String): List<OcrLine> = javaClass.classLoader!!
        .getResourceAsStream(name)!!.bufferedReader().readLines().mapIndexed { i,t ->
            OcrLine(t,i*46,if(t.contains('$')) 60 else 20)
        }
    private val zones=ZoneConfig(1,listOf("Arlington"),listOf("Fairfax"),listOf("Fredericksburg"))

    @Test fun unchangedUberLyftCalibrationThroughNewDetector() {
        val u=DecisionEngine.decide(UniversalOfferDetector.detect(lines("uber-transcript.txt"))!!.candidate!!,DriverSettings(),zones)!!
        val l=DecisionEngine.decide(UniversalOfferDetector.detect(lines("lyft-transcript.txt"))!!.candidate!!,DriverSettings(),zones)!!
        assertEquals("green",u.verdict); assertEquals(3.3185,u.netDollarsPerMile,0.01);assertEquals(74.04,u.netDollarsPerHour,0.01)
        assertEquals("red",l.verdict);assertEquals(0.7662,l.netDollarsPerMile,0.01);assertEquals(39.34,l.netDollarsPerHour,0.01)
    }

    @Test fun doordashCompleteCard() {
        val result=UniversalOfferDetector.detect(lines("doordash-offer.txt"))!!
        assertEquals("DoorDash",result.platform)
        assertEquals(12.75,result.candidate!!.fare,0.001)
        assertEquals(8.6,result.candidate.tripMiles,0.001)
        assertEquals(33.0,result.candidate.tripMinutes,0.001)
    }
    @Test fun instacartCompleteCard() {
        val r=UniversalOfferDetector.detect(lines("instacart-offer.txt"))!!
        assertEquals("Instacart",r.platform);assertEquals(28.50,r.candidate!!.fare,0.001)
        assertEquals(6.2,r.candidate.tripMiles,0.001)
        assertEquals(75.0,r.candidate.tripMinutes,0.001)
    }
    @Test fun amazonFlexHourEstimateNotNet() {
        val r=UniversalOfferDetector.detect(lines("amazon-flex-offer.txt"))!!
        val v=PartialDeliveryGrader.grade(r.partial!!,DriverSettings(),zones)!!
        assertEquals("Amazon Flex",r.platform); assertEquals("yellow",v.verdict)
        assertFalse(v.hasTripMiles);assertTrue(v.hasTripMinutes)
        assertEquals("gross_hour_estimate",v.metricMode)
        assertEquals(92.0/3.0,v.grossHourlyEstimate!!,0.01)
    }
    @Test fun walmartSparkDistanceOnlyNoFabricatedHour() {
        val r=UniversalOfferDetector.detect(lines("spark-offer.txt"))!!
        val v=PartialDeliveryGrader.grade(r.partial!!,DriverSettings(),zones)!!
        assertEquals("Walmart Spark",r.platform);assertEquals("yellow",v.verdict)
        assertTrue(v.hasTripMiles);assertFalse(v.hasTripMinutes)
        assertNull(v.grossHourlyEstimate);assertEquals("per_delivery",v.metricMode)
        assertEquals("dead",v.zoneTier)
    }
    @Test fun partialDeliverySerializesMissingNumbersAsJsonNull() {
        val r=UniversalOfferDetector.detect(lines("spark-offer.txt"))!!
        val v=PartialDeliveryGrader.grade(r.partial!!,DriverSettings(),zones)!!
        val stored=JsonCodec.offer(v)
        val transmitted=SyncPayload.offer(v)
        assertTrue(stored.isNull("tripMinutes"));assertTrue(stored.isNull("netDollarsPerHour"))
        assertTrue(stored.isNull("netDollarsPerMile"));assertEquals("per_delivery",stored.getString("metricMode"))
        assertTrue(transmitted.isNull("trip_minutes"));assertTrue(transmitted.isNull("net_per_mile"))
        assertTrue(transmitted.isNull("net_per_hour"))
        val decoded=JsonCodec.decodeOffer(stored)
        assertFalse(decoded.hasTripMinutes);assertEquals("per_delivery",decoded.metricMode)
        val csv=ExportCodec.offersCSV(listOf(v))
        assertTrue(csv.lineSequence().first().endsWith("metric_mode,gross_hourly_estimate"))
        assertTrue(csv.contains("per_delivery"))
    }
    @Test fun oldRecordJsonWithoutNewKeysStillDecodes() {
        val full=DecisionEngine.decide(OfferCandidate("Uber",41.87,9.3,23.0,2.6,9.0),DriverSettings(),zones)!!
        val old=JsonCodec.offer(full)
        for (key in listOf("metricMode","hasTripMiles","hasTripMinutes","grossHourlyEstimate"))old.remove(key)
        val result=JsonCodec.decodeOffer(old)
        assertEquals("full_trip",result.metricMode)
        assertTrue(result.hasTripMiles && result.hasTripMinutes)
        assertEquals("green",result.verdict)
    }
    @Test fun genericCardAndKilometers() {
        val r=UniversalOfferDetector.detect(lines("generic-offer.txt"))!!
        assertEquals("Unknown app",r.platform)
        assertEquals(4.2 * 0.62137119223733,r.candidate!!.tripMiles,0.001)
    }
    @Test fun sourcePackageOverridesOnScreenBrand() {
        val r=UniversalOfferDetector.detect(lines("doordash-offer.txt"),sourceLabel="IndependentDelivery",sourcePackage="com.example.deliver")!!
        assertEquals("IndependentDelivery",r.platform)
        assertEquals("IndependentDelivery",r.candidate!!.platform)
        assertEquals("Amazon Flex",SourceAppNames.knownName("com.amazon.flex.rabbit"))
        assertNull(SourceAppNames.knownName("not.in.map"))
    }
    @Test fun genericEvidenceRequiresTwoIndependentSignsAndRejectsMapCheckout() {
        assertTrue(LiveOfferGate.looksLikeOffer(lines("amazon-flex-offer.txt")))
        assertFalse(LiveOfferGate.looksLikeOffer(listOf(OcrLine("$22.00",0),OcrLine("4 miles",40))))
        assertFalse(LiveOfferGate.looksLikeOffer(listOf(OcrLine("Map",0),OcrLine("$22.00",40),OcrLine("4 miles",80),OcrLine("22 min",120))))
        assertFalse(LiveOfferGate.looksLikeOffer(listOf(OcrLine("Checkout",0),OcrLine("$22.00",40),OcrLine("4 miles",80),OcrLine("22 min",120))))
    }
    @Test fun badgeColorsAndLabelsMatchStoredVerdict() {
        val green=VerdictBadgeStyle.forVerdict("green")
        val yellow=VerdictBadgeStyle.forVerdict("yellow")
        val red=VerdictBadgeStyle.forVerdict("red")
        assertEquals("ACCEPT",green.title);assertEquals("BORDERLINE",yellow.title);assertEquals("SKIP",red.title)
        assertNotEquals(green.argb,yellow.argb);assertNotEquals(yellow.argb,red.argb);assertNotEquals(green.argb,red.argb)
        assertEquals(0xFFC28A11.toInt(),yellow.argb)
    }
    @Test fun deduplicatesGenericCardsAcrossFrames() {
        val candidate=UniversalOfferDetector.detect(lines("generic-offer.txt"))!!.fingerprintCandidate()
        val filter=LiveOfferDedup()
        assertTrue(filter.shouldLog(candidate,1_000))
        assertFalse(filter.shouldLog(candidate,3_000))
        assertTrue(filter.shouldLog(candidate.copy(fare=candidate.fare+1),3_500))
    }
}
