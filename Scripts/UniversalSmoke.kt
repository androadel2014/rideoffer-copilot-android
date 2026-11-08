package com.rideoffercopilot.android

import java.io.File
import kotlin.math.abs

fun main(args: Array<String>) {
    check(args.size==1)
    val fixtures=File(args[0],"app/src/test/resources")
    fun lines(file:String) = File(fixtures,file).readLines().mapIndexed { i,line ->
        OcrLine(line,i*46,if(line.contains('$')) 60 else 19)
    }
    val zone=ZoneConfig(1,listOf("Arlington"),listOf("Fairfax"),listOf("Fredericksburg"))
    fun checkClose(a:Double,b:Double)=check(abs(a-b)<0.01){"Expected $b got $a"}
    val uber=UniversalOfferDetector.detect(lines("uber-transcript.txt"))!!
    val lyft=UniversalOfferDetector.detect(lines("lyft-transcript.txt"))!!
    val u=DecisionEngine.decide(uber.candidate!!,DriverSettings(),zone)!!
    val l=DecisionEngine.decide(lyft.candidate!!,DriverSettings(),zone)!!
    check(uber.parser=="tuned_uber" && lyft.parser=="tuned_lyft")
    check(u.verdict=="green" && l.verdict=="red")
    checkClose(u.netDollarsPerMile,3.3185);checkClose(u.netDollarsPerHour,74.04)
    checkClose(l.netDollarsPerMile,0.7662);checkClose(l.netDollarsPerHour,39.34)
    println("PASS: legacy Uber/Lyft first-class parsing, locked sample calibration")

    for ((name,platform) in listOf("doordash-offer.txt" to "DoorDash","instacart-offer.txt" to "Instacart")) {
        val detected=UniversalOfferDetector.detect(lines(name))!!
        check(detected.platform==platform && detected.candidate!=null){"$platform: $detected"}
        check(detected.candidate.tripMiles>0 && detected.candidate.tripMinutes>0)
        val grade=DecisionEngine.decide(detected.candidate,DriverSettings(),zone)!!
        check(grade.metricMode=="full_trip")
        println("PASS: $platform full-duration-and-distance fixture")
    }
    val amazon=UniversalOfferDetector.detect(lines("amazon-flex-offer.txt"))!!
    val amazonGrade=PartialDeliveryGrader.grade(amazon.partial!!,DriverSettings(),zone)!!
    check(amazon.platform=="Amazon Flex" && amazonGrade.verdict=="yellow")
    check(!amazonGrade.hasTripMiles && amazonGrade.hasTripMinutes)
    check(amazonGrade.metricMode=="gross_hour_estimate")
    checkClose(amazonGrade.grossHourlyEstimate!!,92.0/3.0)
    println("PASS: Amazon Flex duration-only -> yellow; gross hourly estimate, no fictitious NET")

    val spark=UniversalOfferDetector.detect(lines("spark-offer.txt"))!!
    val sparkGrade=PartialDeliveryGrader.grade(spark.partial!!,DriverSettings(),zone)!!
    check(spark.platform=="Walmart Spark" && sparkGrade.metricMode=="per_delivery")
    check(sparkGrade.hasTripMiles && !sparkGrade.hasTripMinutes && sparkGrade.zoneTier=="dead")
    check(sparkGrade.reasons.contains("DEAD-ZONE"))
    println("PASS: Walmart Spark mileage-only -> yellow; $/delivery and dead-zone warning")

    val generic=UniversalOfferDetector.detect(lines("generic-offer.txt"))!!
    check(generic.platform=="Unknown app" && generic.candidate != null)
    checkClose(generic.candidate.tripMiles,4.2*0.62137119223733)
    println("PASS: unknown work app; generic candidate, km-to-mi conversion")

    check(UniversalOfferDetector.looksLikeOffer(lines("spark-offer.txt")))
    check(!UniversalOfferDetector.looksLikeOffer(listOf(OcrLine("$17.00",0),OcrLine("8.0 mi",40))))
    check(!UniversalOfferDetector.looksLikeOffer(listOf(OcrLine("$48/hour",0),OcrLine("1 mi",40),OcrLine("Pick up",80))))
    val d=UniversalOfferDetector.detect(lines("doordash-offer.txt"),sourceLabel="WorkX",sourcePackage="org.workx")!!
    check(d.platform=="WorkX" && d.candidate?.platform=="WorkX")
    check(SourceAppNames.knownName("com.doordash.driverapp")=="DoorDash")
    check(SourceAppNames.knownName("com.walmart.sparkdriver")=="Walmart Spark")
    check(SourceAppNames.knownName("unknown.app")==null)
    println("PASS: generic shape gate and source-package label precedence")

    val style=listOf("green" to "ACCEPT","yellow" to "BORDERLINE","red" to "SKIP")
        .map{(color,title)->VerdictBadgeStyle.forVerdict(color).also{check(it.title==title)}}
    check(style.map{it.argb}.toSet().size==3)
    check(style[0].argb!=style[1].argb && style[1].argb!=style[2].argb)
    println("PASS: all 3 badge colors and titles distinct, including AMBER for yellow")

    val filter=LiveOfferDedup()
    check(filter.shouldLog(generic.fingerprintCandidate(),1000L))
    check(!filter.shouldLog(generic.fingerprintCandidate(),3000L))
    check(filter.shouldLog(generic.fingerprintCandidate().copy(fare=25.0),3001L))
    println("PASS: dedup unchanged; generic offer dedup")
    val redacted=CardPrivacy.sanitize(listOf(OcrLine("Josh",0),OcrLine("Josh Verified ★4.8",1),OcrLine("$18.25",2)))
    check(!redacted.contains("Josh") && redacted.contains("Verified ★4.8"))
    val labelled=CardPrivacy.sanitize(listOf(OcrLine("Pick up Josh",0),OcrLine("UberX Sarah",1),OcrLine("123 Main St, Fairfax, VA",2)))
    check(!labelled.contains("Josh") && !labelled.contains("Sarah") && labelled.contains("123 Main St"))
    println("PASS: customer/rider name sanitizer fixture")
}
