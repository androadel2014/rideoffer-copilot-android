package com.rideoffercopilot.android

import org.junit.Assert.*
import org.junit.Test

class LiveWatchTests {
    private fun fixture(lines: List<String>) = lines.mapIndexed { i, line ->
        OcrLine(line, i * 25, if (line.startsWith('$')) 45 else 18)
    }

    @Test fun uberAndLyftOfferCardsPassGate() {
        val uber = fixture(listOf("UberX", "$41.87", "9 min (2.6 mi)","23 mins (9.3 mi)","Match"))
        val lyft = fixture(listOf("$449.00 Incl. $50 bonus", "5 min · 0.7 mi", "4 hr 29 min · 232 mi", "Comfort", "Accept"))
        assertTrue(LiveOfferGate.looksLikeOffer(uber))
        assertTrue(LiveOfferGate.looksLikeOffer(lyft))
        assertNotNull(OfferParser.scan(uber))
        assertNotNull(OfferParser.scan(lyft))
    }

    @Test fun navigationMapsAndNormalReceiptsFailGate() {
        val map = fixture(listOf("Uber", "Map", "9 min", "$42.00", "7.2 mi"))
        val receipt = fixture(listOf("$42.00", "30 min · 10 mi", "Groceries", "Checkout"))
        val disabled = fixture(listOf("No offers available", "0 mi", "Match"))
        assertFalse(LiveOfferGate.looksLikeOffer(map))
        assertFalse(LiveOfferGate.looksLikeOffer(receipt))
        assertFalse(LiveOfferGate.looksLikeOffer(disabled))
    }

    @Test fun consecutiveFramesAndMinorDropoutsDoNotDuplicate() {
        val first = OfferCandidate("Uber",41.87,9.3,23.0,2.6,9.0,dropoffText="Arlington, VA")
        val filter = LiveOfferDedup()
        assertTrue(filter.shouldLog(first,1000))
        assertFalse(filter.shouldLog(first,3000))
        repeat(3) {filter.onNoOffer()}
        assertFalse(filter.shouldLog(first,8000)) // offer briefly flickered
        assertTrue(filter.shouldLog(first,100_000)) // later independent offer can be recorded
        assertFalse(filter.shouldLog(first,101_000))
    }

    @Test fun differentOfferWithSamePlatformIsLoggedImmediately() {
        val d = LiveOfferDedup()
        val first = OfferCandidate("Lyft",27.0,8.0,15.0,1.0,4.0)
        assertTrue(d.shouldLog(first,1000))
        assertTrue(d.shouldLog(first.copy(fare=28.0),3000))
        assertFalse(d.shouldLog(first.copy(fare=28.0),5000))
    }

    @Test fun sessionResetAllowsSameOfferAgain() {
        val d = LiveOfferDedup()
        val offer = OfferCandidate("Uber",30.0,3.0,13.0)
        assertTrue(d.shouldLog(offer,200))
        d.reset()
        assertTrue(d.shouldLog(offer,300))
    }
}
