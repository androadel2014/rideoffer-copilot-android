package com.rideoffercopilot.screenwatcher

import android.util.Log

/**
 * Process-wide bridge between the capture service and the Expo module.
 *
 * The service outlives Activity recreation, and the module may be recreated on
 * JS reloads, so neither holds a direct reference to the other. Every call is
 * wrapped so a missing/closed JS listener can never crash the capture thread.
 */
internal object WatchBus {
  private const val TAG = "RideOfferWatchBus"

  @Volatile
  var listener: ((String, Map<String, Any?>) -> Unit)? = null

  /** One-shot callback used to resolve the JS `startWatching()` promise. */
  @Volatile
  var startCallback: ((Boolean, String?) -> Unit)? = null

  @Volatile
  var isRunning: Boolean = false

  fun emit(name: String, body: Map<String, Any?>) {
    val l = listener ?: return
    try {
      l.invoke(name, body)
    } catch (t: Throwable) {
      Log.w(TAG, "emit($name) failed: ${t.message}")
    }
  }

  fun completeStart(ok: Boolean, reason: String?) {
    val cb = startCallback ?: return
    startCallback = null
    try {
      cb.invoke(ok, reason)
    } catch (t: Throwable) {
      Log.w(TAG, "start callback failed: ${t.message}")
    }
  }
}
