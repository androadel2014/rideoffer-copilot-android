package com.rideoffercopilot.android

import java.io.File
import kotlin.math.abs

/** Pure JVM smoke suite; runs without Android SDK / ML Kit, see run-core-smoke.sh. */
fun main(args: Array<String>) {
    require(args.size == 1) { "Usage: CoreSmoke <project-root>" }
    val root = File(args[0])
    val src = root.resolve("app/src/test/resources")
    fun ocr(file: String): List<OcrLine> = src.resolve(file).readLines().mapIndexed { i, t ->
        OcrLine(t, i * 50, if (t.trim().startsWith('$')) 55 else 20)
    }
    val zones=ZoneConfig(1,listOf("Arlington","Tysons","Washington DC"), listOf("Vienna","Fairfax"),listOf("Fredericksburg","Stafford"))
    fun near(actual: Double, expected: Double, tolerance: Double=0.01) {
        check(abs(actual-expected)<=tolerance) {"Expected $expected, got $actual"}
    }
    val u=OfferParser.scan(ocr("uber-transcript.txt"))!!
    println("Uber parse: $u")
    check(u.platform=="Uber" && u.fare==41.87 && u.tripMiles==9.3 && u.pickupMiles==2.6 && u.surgeIncludedDollars==18.0)
    val uv=DecisionEngine.decide(u,DriverSettings(),zones)!!
    check(uv.verdict=="green");near(uv.netDollarsPerMile,3.3185);near(uv.netDollarsPerHour,74.04)
    val l=OfferParser.scan(ocr("lyft-transcript.txt"))!!
    println("Lyft parse: $l")
    check(l.platform=="Lyft" && l.tripMinutes==269.0 && l.tripMiles==232.0 && l.surgeIncludedDollars==50.0)
    check(!l.rawText.contains("Josh"))
    val lv=DecisionEngine.decide(l,DriverSettings(),zones)!!
    check(lv.verdict=="red");near(lv.effectiveMiles!!,464.7);near(lv.effectiveMinutes!!,543.0)
    near(lv.netDollarsPerMile,0.7662);near(lv.netDollarsPerHour,39.34)
    val c=OfferParser.scan(ocr("rearranged-transcript.txt"))!!
    check(c.pickupMiles==2.0 && c.tripMiles==8.0 && c.tripMinutes==17.0 && c.dropoffText?.contains("Arlington")==true)
    val borderline=OfferCandidate("Uber",20.0,10.0,20.0,2.0,4.0,dropoffText="20 Main St, Fredericksburg")
    val dead=DecisionEngine.decide(borderline,DriverSettings(),zones)!!
    val hot=DecisionEngine.decide(borderline.copy(dropoffText="Arlington"),DriverSettings(),zones)!!
    check(hot.verdict=="green" && dead.verdict=="red" && dead.reasons.contains("DEAD-ZONE"))
    check(DecisionEngine.decide(OfferCandidate("Uber",300.0,74.9,120.0,1.0,5.0),DriverSettings(),zones)!!.longTripReturnMiles==null)
    check(DecisionEngine.decide(OfferCandidate("Uber",300.0,75.0,120.0,1.0,5.0),DriverSettings(),zones)!!.longTripReturnMiles==75.0)
    check(DecisionEngine.decide(OfferCandidate("Uber",200.0,2.0,4.0),DriverSettings(),zones)!!.verdict=="yellow")
    val clean=CardPrivacy.sanitize(listOf(OcrLine("Josh",0),OcrLine("Josh Verified ★4.8",1),OcrLine("101 St, Arlington",2)))
    check(!clean.contains("Josh") && clean.contains("Verified ★4.8") && clean.contains("Arlington"))
    check(ZoneMatcher.classify("Stafford",ZoneConfig(1,listOf("Stafford"),emptyList(),listOf("Stafford")))=="dead")
    check(ZoneMatcher.classify("Washington DC",ZoneConfig(1,listOf("Washington"),listOf("Washington DC"),emptyList()))=="neutral")
    check(ZoneMatcher.classify("no place",zones)=="neutral")
    println("PASS: 3 parser fixtures, both calibration math, dead zone, thresholds, privacy, zones")
}
