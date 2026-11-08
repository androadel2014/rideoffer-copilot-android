package com.rideoffercopilot.android

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant

object SyncPayload {
    const val APP_VERSION = "2.1.0"
    private fun iso(time: Long) = Instant.ofEpochMilli(time).toString()
    private fun n(o: JSONObject, key: String, value: Any?) {o.put(key,value ?: JSONObject.NULL)}
    fun outcomeString(outcome: String): String = when(outcome) {
        "Accepted (inferred)" -> "accepted_inferred"
        "Rejected / expired (inferred)" -> "rejected_or_expired_inferred"
        "Ended (unknown)" -> "ended_unknown"
        else -> "pending"
    }
    fun offer(o: OfferRecord) = JSONObject().apply {
        put("client_uuid",o.id.lowercase());put("captured_at",iso(o.timestamp))
        put("platform",o.platform);put("fare",o.fare)
        n(this,"surge",o.surgeIncludedDollars ?: o.surgeMultiplier)
        n(this,"pickup_miles",o.pickupMiles);n(this,"pickup_minutes",o.pickupMinutes)
        n(this,"trip_miles",o.tripMiles.takeIf{o.hasTripMiles});n(this,"trip_minutes",o.tripMinutes.takeIf{o.hasTripMinutes})
        n(this,"pickup_text",o.pickupText?.takeIf(CardPrivacy::looksLikeAddress))
        n(this,"dropoff_text",o.dropoffText?.takeIf(CardPrivacy::looksLikeAddress))
        n(this,"rating",o.riderRating);put("verdict",o.verdict)
        n(this,"net_per_mile",o.netDollarsPerMile.takeIf{o.metricMode=="full_trip"});n(this,"net_per_hour",o.netDollarsPerHour.takeIf{o.metricMode=="full_trip"})
        put("outcome",outcomeString(o.outcome))
        put("raw_text",CardPrivacy.sanitize(o.rawText.lines().mapIndexed { i,line -> OcrLine(line,i) }))
    }
    fun wait(w: WaitRecord) = JSONObject().apply {
        put("zone_text",w.zoneText);put("started_at",iso(w.startedAt))
        n(this,"duration_seconds",w.durationSeconds);n(this,"ended_by",w.endedBy)
    }
    fun create(driverID: String, offers: List<OfferRecord>, waits: List<WaitRecord>) = JSONObject().apply {
        put("driver_id",driverID);put("app_version",APP_VERSION)
        put("records",JSONArray().apply {offers.forEach {put(offer(it))}})
        put("waits",JSONArray().apply {waits.forEach {put(wait(it))}})
    }
    fun create(driverID: String, batch: List<OfferDatabase.Pending>): JSONObject = create(driverID,
        batch.filter {it.table=="offers"}.map {JsonCodec.decodeOffer(JSONObject(it.document))},
        batch.filter {it.table=="waits"}.map {JsonCodec.decodeWait(JSONObject(it.document))})
}

class SyncService(private val prefs: DriverPrefs,private val database: OfferDatabase) {
    /** One foreground-triggered call. Every network path is behind this explicit read of OFF-by-default setting. */
    fun syncNow(): String {
        val settings=prefs.load()
        if(!settings.syncEnabled) return "Sync disabled (zero network requests)"
        if(!settings.valid()) return "Invalid settings"
        val driverKey=prefs.getDriverKey()?.takeIf {it.isNotBlank()} ?: return "Driver key missing"
        val base=settings.syncServerBaseURL.trim().trimEnd('/')
        if(!base.startsWith("https://",ignoreCase=true)) return "HTTPS required for sync URL"
        val endpoint = try {URL("$base/api/rideoffer/v1/ingest")} catch (_: Exception) {return "Invalid sync URL"}
        if(endpoint.protocol.lowercase()!="https" || endpoint.host.isBlank() || endpoint.userInfo!=null) return "Invalid HTTPS sync URL"
        var uploaded=0
        // Bound the number of batches per foreground trigger to avoid prolonged operation.
        for (round in 0 until 30) {
            // If user disabled sync while previous batch ran, do NOT start another request.
            if(!prefs.load().syncEnabled) return "Sync disabled; uploaded $uploaded"
            val queued=database.queued(200)
            if(queued.isEmpty()) return "Synced $uploaded item(s)"
            // Group by stamped driver ID; never attribute older records to an edited driver ID.
            fun owner(row: OfferDatabase.Pending): String = if(row.table=="offers")
                JSONObject(row.document).optString("driverID", settings.driverID)
                else JSONObject(row.document).optString("driverID", settings.driverID)
            val batchDriver=owner(queued.first())
            val batch=queued.filter {owner(it)==batchDriver}
            val payload=SyncPayload.create(batchDriver,batch).toString()
            val connection = try { endpoint.openConnection() as HttpURLConnection } catch (_: Exception) {return "Network error; $uploaded uploaded, remaining queued"}
            try {
                connection.requestMethod="POST"
                connection.connectTimeout=20_000;connection.readTimeout=20_000
                connection.doOutput=true;connection.instanceFollowRedirects=false
                connection.setRequestProperty("Content-Type","application/json")
                connection.setRequestProperty("X-Driver-Key",driverKey)
                connection.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
                val code=connection.responseCode
                if(code==401) return "Key rejected (401); data queued"
                if(code!=200) return "Server HTTP $code; data queued"
                val result=connection.inputStream.bufferedReader().use {it.readText()}
                val accepted=JSONObject(result).optInt("accepted",-1)
                if(accepted!=batch.size) return "Server confirmation mismatch ($accepted/${batch.size}); queued"
                val marked=database.markSynced(batch)
                uploaded += marked
                // Edited rows remain unsynced and re-send on a later trigger.
                if(marked!=batch.size) return "Synced $uploaded; changed items left queued"
            } catch (_: Exception) {
                return "Network/response error; $uploaded uploaded, remaining queued"
            } finally {connection.disconnect()}
        }
        return "Synced $uploaded; more items queued"
    }
}
