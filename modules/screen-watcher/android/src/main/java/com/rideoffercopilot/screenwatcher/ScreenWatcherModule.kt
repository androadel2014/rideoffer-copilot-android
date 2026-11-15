package com.rideoffercopilot.screenwatcher

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicBoolean

/**
 * JS-facing API for screen watching.
 *
 * Consent flow (rock-solid by construction):
 *  - startWatching() never rejects. It always resolves {granted, reason}.
 *  - A second call while a consent dialog is pending resolves the first with "superseded".
 *  - Denial resolves {granted:false, reason:"denied"}.
 *  - Grant starts a mediaProjection foreground service; the promise resolves only after
 *    the service has actually obtained the projection (or failed, or timed out).
 *  - A re-grant while already watching tears down the old projection first.
 */
class ScreenWatcherModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var pending: PendingStart? = null

  private class PendingStart(val promise: Promise) {
    private val done = AtomicBoolean(false)
    fun resolve(granted: Boolean, reason: String?) {
      if (!done.compareAndSet(false, true)) return
      try {
        promise.resolve(mapOf("granted" to granted, "reason" to (reason ?: "")))
      } catch (_: Throwable) {
      }
    }
  }

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  override fun definition() = ModuleDefinition {
    Name("ScreenWatcher")

    Events("onCard", "onScreenState", "onWatchStopped", "onWatchError")

    OnCreate {
      WatchBus.listener = { name, body ->
        try {
          sendEvent(name, body)
        } catch (_: Throwable) {
        }
      }
    }

    OnDestroy {
      WatchBus.listener = null
      pending?.resolve(false, "module_destroyed")
      pending = null
    }

    Function("isSupported") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
    }

    Function("isWatching") {
      WatchBus.isRunning
    }

    Function("canDrawOverlays") {
      try {
        Settings.canDrawOverlays(context)
      } catch (_: Throwable) {
        false
      }
    }

    AsyncFunction("openOverlaySettings") {
      try {
        val intent = Intent(
          Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
          Uri.parse("package:" + context.packageName)
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        true
      } catch (_: Throwable) {
        try {
          val fallback = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          context.startActivity(fallback)
          true
        } catch (_: Throwable) {
          false
        }
      }
    }

    AsyncFunction("openAppSettings") {
      try {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        true
      } catch (_: Throwable) {
        false
      }
    }

    AsyncFunction("startWatching") { promise: Promise ->
      requestConsent(promise)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stopWatching") {
      try {
        val intent = Intent(context, ScreenWatchService::class.java).setAction(ScreenWatchService.ACTION_STOP)
        if (WatchBus.isRunning) context.startService(intent)
      } catch (_: Throwable) {
      }
      OverlayController.hide()
      true
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("showOverlay") { payload: Map<String, Any?> ->
      OverlayController.show(context.applicationContext, payload)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("hideOverlay") {
      OverlayController.hide()
      true
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQUEST_CAPTURE) return@OnActivityResult
      val p = pending ?: return@OnActivityResult
      pending = null
      val data = payload.data
      if (payload.resultCode != Activity.RESULT_OK || data == null) {
        p.resolve(false, "denied")
        return@OnActivityResult
      }
      startService(p, payload.resultCode, data)
    }
  }

  private fun requestConsent(promise: Promise) {
    val p = PendingStart(promise)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      p.resolve(false, "unsupported_android")
      return
    }
    val activity = appContext.currentActivity
    if (activity == null || activity.isFinishing) {
      p.resolve(false, "no_activity")
      return
    }
    pending?.resolve(false, "superseded")
    pending = p
    try {
      val mpm = activity.getSystemService(MediaProjectionManager::class.java)
      if (mpm == null) {
        pending = null
        p.resolve(false, "no_projection_service")
        return
      }
      val intent = if (Build.VERSION.SDK_INT >= 34) {
        // Forces "entire screen" so the driver cannot accidentally share only one app.
        mpm.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
      } else {
        mpm.createScreenCaptureIntent()
      }
      activity.startActivityForResult(intent, REQUEST_CAPTURE)
    } catch (t: Throwable) {
      pending = null
      p.resolve(false, "launch_failed")
    }
  }

  private fun startService(p: PendingStart, resultCode: Int, data: Intent) {
    val ctx = try {
      context
    } catch (_: Throwable) {
      p.resolve(false, "no_context"); return
    }
    WatchBus.completeStart(false, "superseded")
    val callback: (Boolean, String?) -> Unit = { ok, reason -> mainHandler.post { p.resolve(ok, reason) } }
    WatchBus.startCallback = callback
    try {
      val svc = Intent(ctx, ScreenWatchService::class.java)
        .setAction(ScreenWatchService.ACTION_START)
        .putExtra(ScreenWatchService.EXTRA_RESULT_CODE, resultCode)
        .putExtra(ScreenWatchService.EXTRA_RESULT_DATA, data)
      ContextCompat.startForegroundService(ctx, svc)
    } catch (t: Throwable) {
      WatchBus.completeStart(false, "service_start_failed")
      return
    }
    mainHandler.postDelayed({
      // Only time out *this* attempt, never a newer one.
      if (WatchBus.startCallback === callback) WatchBus.completeStart(false, "timeout")
    }, START_TIMEOUT_MS)
  }

  companion object {
    private const val REQUEST_CAPTURE = 23571
    private const val START_TIMEOUT_MS = 10_000L
  }
}
