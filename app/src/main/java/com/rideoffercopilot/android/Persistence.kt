package com.rideoffercopilot.android

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

private fun JSONObject.optionalNum(k: String, n: Double?): JSONObject = put(k, n ?: JSONObject.NULL)
private fun JSONObject.optionalText(k: String, t: String?): JSONObject = put(k, t ?: JSONObject.NULL)
private fun JSONObject.optNullableDouble(k: String): Double? = if (isNull(k) || !has(k)) null else optDouble(k)
private fun JSONObject.optNullableString(k: String): String? = if (isNull(k) || !has(k)) null else getString(k)
private fun JSONObject.optNullableLong(k: String): Long? = if (isNull(k) || !has(k)) null else getLong(k)

object JsonCodec {
    fun offer(o: OfferRecord): JSONObject = JSONObject().apply {
        put("id", o.id); put("timestamp", o.timestamp); put("platform", o.platform); put("fare", o.fare)
        put("tripMiles", o.tripMiles); put("tripMinutes", o.tripMinutes)
        optionalNum("pickupMiles", o.pickupMiles); optionalNum("pickupMinutes", o.pickupMinutes)
        optionalNum("riderRating", o.riderRating); optionalNum("surgeMultiplier", o.surgeMultiplier)
        optionalNum("surgeIncludedDollars", o.surgeIncludedDollars)
        put("netDollarsPerMile", o.netDollarsPerMile); put("netDollarsPerHour", o.netDollarsPerHour)
        put("netDollarsPerMinute", o.netDollarsPerMinute); put("assumedPickupMissing", o.assumedPickupMissing)
        put("verdict", o.verdict); put("outcome", o.outcome); optionalNum("outcomeTimestamp", o.outcomeTimestamp?.toDouble())
        put("reasons", o.reasons); optionalText("pickupText", o.pickupText?.takeIf(CardPrivacy::looksLikeAddress))
        optionalText("dropoffText", o.dropoffText?.takeIf(CardPrivacy::looksLikeAddress))
        put("rawText", CardPrivacy.sanitize(o.rawText.lines().mapIndexed { index, text -> OcrLine(text, index) }))
        put("extractionMethod", o.extractionMethod); put("driverID", o.driverID); put("zoneTier", o.zoneTier)
        optionalNum("deadZoneRepositionMiles", o.deadZoneRepositionMiles)
        optionalNum("deadZoneRepositionMinutes", o.deadZoneRepositionMinutes)
        optionalNum("longTripReturnMiles", o.longTripReturnMiles)
        optionalNum("longTripReturnMinutes", o.longTripReturnMinutes)
        optionalNum("effectiveMiles", o.effectiveMiles); optionalNum("effectiveMinutes", o.effectiveMinutes)
    }
    fun decodeOffer(j: JSONObject): OfferRecord = OfferRecord(
        id=j.getString("id"), timestamp=j.getLong("timestamp"), platform=j.getString("platform"),
        fare=j.getDouble("fare"), tripMiles=j.getDouble("tripMiles"), tripMinutes=j.getDouble("tripMinutes"),
        pickupMiles=j.optNullableDouble("pickupMiles"), pickupMinutes=j.optNullableDouble("pickupMinutes"),
        riderRating=j.optNullableDouble("riderRating"), surgeMultiplier=j.optNullableDouble("surgeMultiplier"),
        surgeIncludedDollars=j.optNullableDouble("surgeIncludedDollars"),
        netDollarsPerMile=j.getDouble("netDollarsPerMile"), netDollarsPerHour=j.getDouble("netDollarsPerHour"),
        netDollarsPerMinute=j.getDouble("netDollarsPerMinute"), assumedPickupMissing=j.getBoolean("assumedPickupMissing"),
        verdict=j.getString("verdict"), outcome=j.optString("outcome", "Pending"),
        outcomeTimestamp=j.optNullableLong("outcomeTimestamp"), reasons=j.getString("reasons"),
        pickupText=j.optNullableString("pickupText"), dropoffText=j.optNullableString("dropoffText"),
        rawText=j.optString("rawText", ""), extractionMethod=j.optString("extractionMethod", "pattern_scan"),
        driverID=j.optString("driverID", "driver-1"), zoneTier=j.optString("zoneTier", "neutral"),
        deadZoneRepositionMiles=j.optNullableDouble("deadZoneRepositionMiles"),
        deadZoneRepositionMinutes=j.optNullableDouble("deadZoneRepositionMinutes"),
        longTripReturnMiles=j.optNullableDouble("longTripReturnMiles"),
        longTripReturnMinutes=j.optNullableDouble("longTripReturnMinutes"),
        effectiveMiles=j.optNullableDouble("effectiveMiles"), effectiveMinutes=j.optNullableDouble("effectiveMinutes")
    )
    fun wait(w: WaitRecord): JSONObject = JSONObject().apply {
        put("id",w.id); put("driverID",w.driverID); put("zoneText",w.zoneText)
        put("startedAt",w.startedAt); optionalNum("durationSeconds",w.durationSeconds); optionalText("endedBy",w.endedBy)
    }
    fun decodeWait(j: JSONObject) = WaitRecord(j.getString("id"),j.optString("driverID","driver-1"),
        j.getString("zoneText"),j.getLong("startedAt"),j.optNullableDouble("durationSeconds"),j.optNullableString("endedBy"))
}

class OfferDatabase(context: Context): SQLiteOpenHelper(context, "rideoffer.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE IF NOT EXISTS offers (id TEXT PRIMARY KEY, timestamp REAL NOT NULL, document TEXT NOT NULL, synced_at REAL NULL)")
        db.execSQL("CREATE TABLE IF NOT EXISTS waits (id TEXT PRIMARY KEY, started_at REAL NOT NULL, document TEXT NOT NULL, synced_at REAL NULL)")
        db.execSQL("CREATE INDEX IF NOT EXISTS offers_unsynced ON offers (synced_at, timestamp)")
        db.execSQL("CREATE INDEX IF NOT EXISTS waits_unsynced ON waits (synced_at, started_at)")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) { /* New Android app, no migration yet. */ }
    fun addOffer(o: OfferRecord) {
        val data = ContentValues().apply {
            put("id",o.id);put("timestamp",o.timestamp.toDouble());put("document",JsonCodec.offer(o).toString())
        }
        writableDatabase.insertOrThrow("offers",null,data)
    }
    fun offers(): List<OfferRecord> = readableDatabase.rawQuery("SELECT document FROM offers ORDER BY timestamp DESC",null).use { c ->
        buildList { while(c.moveToNext()) add(JsonCodec.decodeOffer(JSONObject(c.getString(0)))) }
    }
    fun waits(): List<WaitRecord> = readableDatabase.rawQuery("SELECT document FROM waits ORDER BY started_at DESC",null).use { c ->
        buildList { while(c.moveToNext()) add(JsonCodec.decodeWait(JSONObject(c.getString(0)))) }
    }
    fun addWait(w: WaitRecord) {
        val data = ContentValues().apply {put("id",w.id);put("started_at",w.startedAt.toDouble());put("document",JsonCodec.wait(w).toString())}
        writableDatabase.insertOrThrow("waits",null,data)
    }
    fun updateOutcome(id: String, outcome: String): OfferRecord? {
        val old = offers().firstOrNull { it.id == id } ?: return null
        val updated = old.copy(outcome=outcome, outcomeTimestamp=System.currentTimeMillis())
        writableDatabase.execSQL("UPDATE offers SET document=?, synced_at=NULL WHERE id=?",
            arrayOf(JsonCodec.offer(updated).toString(), id))
        return updated
    }
    fun deleteOffer(id: String) { writableDatabase.delete("offers","id=?", arrayOf(id)) }
    fun deleteAll() { writableDatabase.delete("offers",null,null); writableDatabase.delete("waits",null,null) }

    data class Pending(val table: String, val id: String, val order: Double, val document: String)
    fun queued(limit: Int = 200): List<Pending> {
        val offerQueue = readableDatabase.rawQuery("SELECT id,timestamp,document FROM offers WHERE synced_at IS NULL ORDER BY timestamp ASC LIMIT ?",arrayOf(limit.toString())).use { c ->
            buildList { while(c.moveToNext()) add(Pending("offers",c.getString(0),c.getDouble(1),c.getString(2))) }
        }
        val waitQueue = readableDatabase.rawQuery("SELECT id,started_at,document FROM waits WHERE synced_at IS NULL ORDER BY started_at ASC LIMIT ?",arrayOf(limit.toString())).use { c ->
            buildList { while(c.moveToNext()) add(Pending("waits",c.getString(0),c.getDouble(1),c.getString(2))) }
        }
        return (offerQueue + waitQueue).sortedBy { it.order }.take(limit.coerceIn(1,200))
    }
    /** Mark precisely the sent immutable JSON versions, not rows edited during HTTP. */
    fun markSynced(rows: List<Pending>): Int {
        val db = writableDatabase
        db.beginTransaction()
        try {
            var count=0
            for (r in rows) {
                val values=ContentValues().apply { put("synced_at", System.currentTimeMillis().toDouble()) }
                count += db.update(r.table, values, "id=? AND document=? AND synced_at IS NULL",arrayOf(r.id,r.document))
            }
            db.setTransactionSuccessful()
            return count
        } finally {db.endTransaction()}
    }
}

object ExportCodec {
    private const val OFFER_HEADER = "timestamp,platform,fare,trip_miles,trip_minutes,pickup_miles,pickup_minutes,total_miles,total_minutes,net_dollars_per_mile,net_dollars_per_hour,net_dollars_per_minute,verdict,outcome,pickup_incomplete,rider_rating,surge_multiplier,surge_included_dollars,long_return_miles,long_return_minutes,effective_miles,effective_minutes,notes,driver_id,pickup_text,dropoff_text,raw_text,extraction_method,zone_tier,dead_zone_extra_miles,dead_zone_extra_minutes"
    private fun q(s: Any?): String = "\"${s?.toString().orEmpty().replace("\"","\"\"")}\""
    private fun iso(ms: Long): String = Instant.ofEpochMilli(ms).toString()
    fun offersCSV(rows: List<OfferRecord>): String = buildList {
        add(OFFER_HEADER)
        for (r in rows) add(listOf(iso(r.timestamp),r.platform,r.fare,r.tripMiles,r.tripMinutes,r.pickupMiles,r.pickupMinutes,
            r.totalMiles,r.totalMinutes,r.netDollarsPerMile,r.netDollarsPerHour,r.netDollarsPerMinute,
            when(r.verdict) {"green" -> "ACCEPT";"yellow" -> "BORDERLINE";else -> "DECLINE"},r.outcome,r.assumedPickupMissing,
            r.riderRating,r.surgeMultiplier,r.surgeIncludedDollars,r.longTripReturnMiles,r.longTripReturnMinutes,
            r.effectiveMiles,r.effectiveMinutes,r.reasons,r.driverID,r.pickupText,r.dropoffText,r.rawText,
            r.extractionMethod,r.zoneTier,r.deadZoneRepositionMiles,r.deadZoneRepositionMinutes).joinToString(",") {q(it)})
    }.joinToString("\r\n")
    fun waitsCSV(rows: List<WaitRecord>): String = buildList {
        add("driver_id,zone_text,started_at,duration_seconds,ended_by")
        for(w in rows) add(listOf(w.driverID,w.zoneText,iso(w.startedAt),w.durationSeconds,w.endedBy).joinToString(",") {q(it)})
    }.joinToString("\r\n")
    fun offersJSON(rows: List<OfferRecord>): String = JSONArray().apply {rows.forEach {put(JsonCodec.offer(it))}}.toString(2)
    fun waitsJSON(rows: List<WaitRecord>): String = JSONArray().apply {rows.forEach {put(JsonCodec.wait(it))}}.toString(2)
}
