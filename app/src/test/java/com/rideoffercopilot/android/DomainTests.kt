package com.rideoffercopilot.android

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject

class DomainTests {
    private val zones = ZoneConfig(1,
        hot=listOf("Arlington","Tysons","Washington DC","DCA","Bethesda"),
        neutral=listOf("Vienna","Fairfax"),
        dead=listOf("Fredericksburg","Stafford","Culpeper"))
    private val settings=DriverSettings()
    private fun lines(resource: String): List<OcrLine> {
        val raw=javaClass.classLoader!!.getResourceAsStream(resource)!!.bufferedReader().readLines()
        return raw.mapIndexed{i,s -> OcrLine(s,i*40, if(s.trim().startsWith('$')) 50 else 22)}
    }
    @Test fun uberCalibrationAndSummaryRemoval() {
        val c=OfferParser.scan(lines("uber-transcript.txt"))!!
        assertEquals("Uber",c.platform)
        assertEquals(41.87,c.fare,0.001)
        assertEquals(9.3,c.tripMiles,0.001)
        assertEquals(23.0,c.tripMinutes,0.001)
        assertEquals(2.6,c.pickupMiles!!,0.001)
        assertEquals(9.0,c.pickupMinutes!!,0.001)
        assertEquals(4.97,c.riderRating!!,0.001)
        assertEquals(18.0,c.surgeIncludedDollars!!,0.001)
        val v=DecisionEngine.decide(c,settings,zones)!!
        assertEquals("green",v.verdict)
        assertEquals(3.3185,v.netDollarsPerMile,0.01)
        assertEquals(74.04,v.netDollarsPerHour,0.01)
        assertEquals("hot",v.zoneTier)
    }
    @Test fun lyftCalibrationEmptyReturnAndRatingPrivacy() {
        val c=OfferParser.scan(lines("lyft-transcript.txt"))!!
        assertEquals("Lyft",c.platform)
        assertEquals(449.0,c.fare,0.001)
        assertEquals(232.0,c.tripMiles,0.001)
        assertEquals(269.0,c.tripMinutes,0.001)
        assertEquals(0.7,c.pickupMiles!!,0.001)
        assertEquals(5.0,c.pickupMinutes!!,0.001)
        assertEquals(50.0,c.surgeIncludedDollars!!,0.001)
        assertEquals(4.8,c.riderRating!!,0.001)
        assertFalse(c.rawText.contains("Josh"))
        val v=DecisionEngine.decide(c,settings,zones)!!
        assertEquals("red",v.verdict)
        assertEquals("neutral",v.zoneTier)
        assertEquals(464.7,v.effectiveMiles!!,0.01)
        assertEquals(543.0,v.effectiveMinutes!!,0.01)
        assertEquals(0.7662,v.netDollarsPerMile,0.01)
        assertEquals(39.34,v.netDollarsPerHour,0.01)
        assertTrue(v.reasons.contains("LONG TRIP"))
    }
    @Test fun syntheticRearrangedCard() {
        val c=OfferParser.scan(lines("rearranged-transcript.txt"))!!
        assertEquals("Lyft",c.platform)
        assertEquals(36.0,c.fare,0.01)
        assertEquals(2.0,c.pickupMiles!!,0.001)
        assertEquals(5.0,c.pickupMinutes!!,0.001)
        assertEquals(8.0,c.tripMiles,0.001)
        assertEquals(17.0,c.tripMinutes,0.001)
        assertTrue(c.dropoffText!!.contains("Arlington"))
    }
    @Test fun zonePenaltyChangesBorderlineAndClassification() {
        val candidate=OfferCandidate("Uber",20.0,10.0,20.0,2.0,4.0,dropoffText="20 Main St, Fredericksburg")
        val dead=DecisionEngine.decide(candidate,settings,zones)!!
        val neutral=DecisionEngine.decide(candidate.copy(dropoffText="10 Main St, Vienna"),settings,zones)!!
        assertEquals("dead",dead.zoneTier)
        assertEquals(20.0,dead.effectiveMiles!!,0.001)
        assertEquals(49.0,dead.effectiveMinutes!!,0.001)
        assertEquals("green",neutral.verdict)
        assertEquals("red",dead.verdict)
        assertTrue(dead.reasons.contains("DEAD-ZONE DROPOFF"))
        assertEquals("dead",ZoneMatcher.classify("Stafford",ZoneConfig(1,listOf("Stafford"),emptyList(),listOf("Stafford"))))
        assertEquals("neutral",ZoneMatcher.classify("Location unknown",zones))
        assertEquals("neutral",ZoneMatcher.classify("Washington DC",ZoneConfig(1,listOf("Washington"),listOf("Washington DC"),emptyList())))
    }
    @Test fun longTripBoundary() {
        fun grade(miles: Double)=DecisionEngine.decide(OfferCandidate("Uber",300.0,miles,120.0,1.0,5.0),settings,zones)!!
        assertNull(grade(74.9).longTripReturnMiles)
        assertEquals(75.0,grade(75.0).longTripReturnMiles!!,0.001)
    }
    @Test fun missingPickupCanNeverBeGreen() {
        val c=OfferCandidate("Uber",200.0,2.0,4.0)
        val v=DecisionEngine.decide(c,settings,zones)!!
        assertEquals("yellow",v.verdict)
        assertTrue(v.assumedPickupMissing)
    }
    @Test fun sanitizerDropsNameAndKeepsKnownFragments() {
        val text=CardPrivacy.sanitize(listOf(OcrLine("Josh",1), OcrLine("Josh Verified ★4.8",2),
            OcrLine("$41.87",3),OcrLine("9 min (2.6 mi)",4),
            OcrLine("101 Main St, Vienna",5), OcrLine("John Lane",6), OcrLine("Josh St",7)))
        assertFalse(text.contains("Josh"))
        assertFalse(text.contains("John Lane"))
        assertTrue(text.contains("Verified ★4.8"))
        assertTrue(text.contains("101 Main St, Vienna"))
        assertTrue(text.contains("$41.87"))
    }
    @Test fun payloadKeysNullsOutcomes() {
        val r=DecisionEngine.decide(OfferCandidate("Uber",20.0,5.0,15.0),settings,zones)!!.copy(
            id="01234567-89AB-CDEF-0123-456789ABCDEF",timestamp=0L)
        val payload=SyncPayload.create("driver-1",listOf(r),listOf(WaitRecord(
            driverID="driver-1",zoneText="Arlington",startedAt=60000L,durationSeconds=90.0,endedBy="offer")))
        assertEquals(setOf("driver_id","app_version","records","waits"),payload.keys().asSequence().toSet())
        val o=payload.getJSONArray("records").getJSONObject(0)
        assertEquals(setOf("client_uuid","captured_at","platform","fare","surge","pickup_miles","pickup_minutes",
            "trip_miles","trip_minutes","pickup_text","dropoff_text","rating","verdict","net_per_mile","net_per_hour","outcome","raw_text"),o.keys().asSequence().toSet())
        assertEquals("01234567-89ab-cdef-0123-456789abcdef",o.getString("client_uuid"))
        assertEquals("1970-01-01T00:00:00Z",o.getString("captured_at"))
        assertTrue(o.isNull("surge"));assertTrue(o.isNull("pickup_miles"));assertTrue(o.isNull("pickup_text"))
        assertEquals("pending",o.getString("outcome"))
        assertEquals("accepted_inferred",SyncPayload.outcomeString("Accepted (inferred)"))
        assertEquals("rejected_or_expired_inferred",SyncPayload.outcomeString("Rejected / expired (inferred)"))
        assertEquals("ended_unknown",SyncPayload.outcomeString("Ended (unknown)"))
        val w=payload.getJSONArray("waits").getJSONObject(0)
        assertEquals(setOf("zone_text","started_at","duration_seconds","ended_by"),w.keys().asSequence().toSet())
    }
    @Test fun invalidSettingsRejected() {
        assertFalse(settings.copy(greenDollarsPerMile=0.1).valid())
        assertFalse(settings.copy(greenDollarsPerHour=10.0).valid())
        assertFalse(settings.copy(longTripOneWayMiles=0.0).valid())
        assertFalse(settings.copy(runningCostPerMile=Double.NaN).valid())
        assertFalse(settings.copy(driverID=" ").valid())
        assertFalse(settings.copy(driverID="x".repeat(129)).valid())
    }
}
