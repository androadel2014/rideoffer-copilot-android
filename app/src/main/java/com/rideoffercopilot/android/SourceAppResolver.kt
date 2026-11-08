package com.rideoffercopilot.android

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Process

/** MediaProjection exposes pixels, never the originating package. Usage Access is OPTIONAL,
 * explicitly user-granted in system Settings, and never needed for OCR/grading.
 * Package names and usage events are not written to SQLite or transmitted.
 */
class SourceAppResolver(private val context: Context) {
    private var activePackage: String? = null
    private var lastQueryAt = 0L

    fun hasUsageAccess(): Boolean = try {
        val ops = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName) == AppOpsManager.MODE_ALLOWED
    } catch (_: Exception) {false}

    fun currentPackage(): String? {
        if (!hasUsageAccess()) {activePackage=null;return null}
        val now=System.currentTimeMillis()
        if (now-lastQueryAt < 1200) return activePackage
        val begin=if (lastQueryAt==0L) now-3*60*60*1000 else (lastQueryAt-3000).coerceAtLeast(now-3*60*60*1000)
        lastQueryAt=now
        try {
            val usage=context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val events=usage.queryEvents(begin,now) ?: return activePackage
            val event=UsageEvents.Event()
            while(events.hasNextEvent()) {
                events.getNextEvent(event)
                if(event.eventType != UsageEvents.Event.ACTIVITY_RESUMED) continue
                val pkg=event.packageName ?: continue
                if(pkg==context.packageName || pkg.startsWith("com.android.systemui") || pkg.startsWith("com.samsung.android.systemui")) continue
                activePackage=pkg
            }
        } catch (_: SecurityException) {activePackage=null}
        return activePackage
    }

    fun nameOf(packageName: String?): String {
        SourceAppNames.knownName(packageName)?.let{return it}
        if (packageName.isNullOrBlank()) return "Unknown app"
        return try {
            @Suppress("DEPRECATION")
            val info=context.packageManager.getApplicationInfo(packageName,0)
            context.packageManager.getApplicationLabel(info).toString().trim().takeIf{it.isNotEmpty()} ?: "Unknown app"
        } catch (_: Exception) {"Unknown app"}
    }
}
