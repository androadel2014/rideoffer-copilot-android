package com.rideoffercopilot.screenwatcher

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Foreground service (type = mediaProjection) that owns the screen-capture session.
 *
 * Threading: all capture/OCR work runs on a dedicated HandlerThread. Teardown is
 * posted to that same thread so it is serialized after any in-flight frame; it can
 * never race the frame loop. Every entry point is wrapped so a failure stops the
 * session and reports it, rather than crashing the app.
 */
class ScreenWatchService : Service() {

  private class Session(
    val projection: MediaProjection,
    val thread: HandlerThread,
    val handler: Handler,
    val callback: MediaProjection.Callback,
  ) {
    var display: VirtualDisplay? = null
    var reader: ImageReader? = null
    var processor: FrameProcessor? = null
    var captureWidth = 0
    var captureHeight = 0
    var scaleToScreen = 1f
    var paddedBitmap: Bitmap? = null
    val alive = AtomicBoolean(true)
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  @Volatile private var session: Session? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    try {
      when (intent?.action) {
        ACTION_START -> handleStart(intent)
        ACTION_STOP -> stopWatching("user")
        else -> {
          // Restarted by the system without consent data: nothing to resume.
          stopWatching("system")
        }
      }
    } catch (t: Throwable) {
      fail("unexpected: ${t.message}")
    }
    return START_NOT_STICKY
  }

  private fun handleStart(intent: Intent) {
    // 1) Become a foreground service of type mediaProjection BEFORE touching the projection
    //    (mandatory on Android 14+).
    try {
      ensureChannel()
      val notification = buildNotification()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (t: Throwable) {
      fail("foreground_not_allowed")
      return
    }

    // 2) Re-grant while running: retire the old session first (consent tokens are single-use).
    session?.let { teardown(it) }
    session = null

    val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
    val data: Intent? = if (Build.VERSION.SDK_INT >= 33) {
      intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
    } else {
      @Suppress("DEPRECATION") intent.getParcelableExtra<Intent>(EXTRA_RESULT_DATA)
    }
    if (resultCode != Activity.RESULT_OK || data == null) {
      fail("no_consent")
      return
    }

    val mpm = getSystemService(MediaProjectionManager::class.java)
    val projection = try {
      mpm?.getMediaProjection(resultCode, data)
    } catch (se: SecurityException) {
      null
    } catch (t: Throwable) {
      null
    }
    if (projection == null) {
      fail("projection_unavailable")
      return
    }

    val thread = HandlerThread("rideoffer-capture").also { it.start() }
    val handler = Handler(thread.looper)
    val callback = object : MediaProjection.Callback() {
      override fun onStop() {
        // User tapped "Stop sharing", screen locked on newer Android, or another app took over.
        mainHandler.post { if (session?.projection === projection) stopWatching("system") }
      }
    }
    val s = Session(projection, thread, handler, callback)
    try {
      // 3) Callback must be registered before createVirtualDisplay (Android 14+).
      projection.registerCallback(callback, handler)
      configureDisplay(s, create = true)
      s.processor = FrameProcessor(
        overlayRectInCapture = rect@{
          val r = OverlayController.visibleScreenRect() ?: return@rect null
          val k = 1f / s.scaleToScreen
          android.graphics.Rect((r.left * k).toInt(), (r.top * k).toInt(), (r.right * k).toInt(), (r.bottom * k).toInt())
        },
        emit = { name, body -> WatchBus.emit(name, body) },
      )
    } catch (t: Throwable) {
      teardown(s)
      fail("display_failed")
      return
    }

    session = s
    WatchBus.isRunning = true
    WatchBus.completeStart(true, null)
    WatchBus.emit("onScreenState", mapOf("state" to "started", "ts" to System.currentTimeMillis()))
    handler.post { frameLoop(s) }
  }

  // --- Capture surface --------------------------------------------------------------------

  private fun screenSize(): Pair<Int, Int> {
    val wm = getSystemService(WindowManager::class.java)
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && wm != null) {
      val b = wm.maximumWindowMetrics.bounds
      Pair(b.width(), b.height())
    } else {
      val m = android.util.DisplayMetrics()
      @Suppress("DEPRECATION") wm?.defaultDisplay?.getRealMetrics(m)
      Pair(m.widthPixels.coerceAtLeast(1), m.heightPixels.coerceAtLeast(1))
    }
  }

  /** Captures at <= 1080px on the short edge: plenty for OCR, far cheaper than full QHD. */
  private fun configureDisplay(s: Session, create: Boolean) {
    val (sw, sh) = screenSize()
    val shortEdge = minOf(sw, sh).toFloat()
    val scale = if (shortEdge > MAX_CAPTURE_SHORT_EDGE) MAX_CAPTURE_SHORT_EDGE / shortEdge else 1f
    val cw = (sw * scale).toInt().coerceAtLeast(2) and 1.inv()
    val ch = (sh * scale).toInt().coerceAtLeast(2) and 1.inv()
    val dpi = resources.displayMetrics.densityDpi

    val newReader = ImageReader.newInstance(cw, ch, PixelFormat.RGBA_8888, 2)
    val oldReader = s.reader
    if (create || s.display == null) {
      s.display = s.projection.createVirtualDisplay(
        "RideOfferCopilotCapture", cw, ch, dpi,
        DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
        newReader.surface, null, s.handler
      )
    } else {
      s.display?.resize(cw, ch, dpi)
      s.display?.surface = newReader.surface
    }
    s.reader = newReader
    s.captureWidth = cw
    s.captureHeight = ch
    s.scaleToScreen = 1f / scale
    s.paddedBitmap?.recycle()
    s.paddedBitmap = null
    try { oldReader?.close() } catch (_: Throwable) {}
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    val s = session ?: return
    s.handler.post {
      if (!s.alive.get()) return@post
      try { configureDisplay(s, create = false) } catch (t: Throwable) { Log.w(TAG, "resize failed: ${t.message}") }
    }
  }

  // --- Frame loop -------------------------------------------------------------------------

  private fun frameLoop(s: Session) {
    if (!s.alive.get()) return
    val started = SystemClock.uptimeMillis()
    try {
      val bitmap = grabFrame(s)
      if (bitmap != null) {
        s.processor?.process(bitmap)
      }
    } catch (oom: OutOfMemoryError) {
      Log.w(TAG, "frame skipped (memory)")
    } catch (t: Throwable) {
      Log.w(TAG, "frame failed: ${t.message}")
    }
    if (!s.alive.get()) return
    val elapsed = SystemClock.uptimeMillis() - started
    val delay = (FRAME_INTERVAL_MS - elapsed).coerceAtLeast(MIN_GAP_MS)
    s.handler.postDelayed({ frameLoop(s) }, delay)
  }

  /** Returns a bitmap exactly captureWidth x captureHeight, or null if no new frame. */
  private fun grabFrame(s: Session): Bitmap? {
    val reader = s.reader ?: return null
    val image = try { reader.acquireLatestImage() } catch (_: Throwable) { null } ?: return null
    try {
      val plane = image.planes[0]
      val pixelStride = plane.pixelStride
      val rowStride = plane.rowStride
      val paddedWidth = rowStride / pixelStride
      var padded = s.paddedBitmap
      if (padded == null || padded.width != paddedWidth || padded.height != image.height) {
        padded?.recycle()
        padded = Bitmap.createBitmap(paddedWidth, image.height, Bitmap.Config.ARGB_8888)
        s.paddedBitmap = padded
      }
      plane.buffer.rewind()
      padded!!.copyPixelsFromBuffer(plane.buffer)
      return if (paddedWidth == image.width) {
        padded.copy(Bitmap.Config.ARGB_8888, false)
      } else {
        Bitmap.createBitmap(padded, 0, 0, image.width, image.height)
      }
    } finally {
      try { image.close() } catch (_: Throwable) {}
    }
  }

  // --- Lifecycle --------------------------------------------------------------------------

  private fun teardown(s: Session) {
    if (!s.alive.compareAndSet(true, false)) return
    s.handler.removeCallbacksAndMessages(null)
    s.handler.post {
      try { s.processor?.close() } catch (_: Throwable) {}
      try { s.display?.release() } catch (_: Throwable) {}
      try { s.reader?.close() } catch (_: Throwable) {}
      try { s.paddedBitmap?.recycle() } catch (_: Throwable) {}
      try { s.projection.unregisterCallback(s.callback) } catch (_: Throwable) {}
      try { s.projection.stop() } catch (_: Throwable) {}
      s.thread.quitSafely()
    }
  }

  private fun stopWatching(reason: String) {
    val s = session
    session = null
    if (s != null) teardown(s)
    val wasRunning = WatchBus.isRunning
    WatchBus.isRunning = false
    OverlayController.hide()
    WatchBus.completeStart(false, "stopped")
    if (wasRunning || s != null) {
      WatchBus.emit("onWatchStopped", mapOf("reason" to reason, "ts" to System.currentTimeMillis()))
    }
    try { stopForeground(STOP_FOREGROUND_REMOVE) } catch (_: Throwable) {}
    stopSelf()
  }

  private fun fail(reason: String) {
    Log.w(TAG, "watch failed: $reason")
    WatchBus.completeStart(false, reason)
    WatchBus.emit("onWatchError", mapOf("reason" to reason, "ts" to System.currentTimeMillis()))
    stopWatching("error")
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // The grading pipeline lives in the app's JS runtime; if the driver swipes the app
    // away, stop cleanly instead of capturing frames nobody will grade.
    stopWatching("app_closed")
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    val s = session
    session = null
    if (s != null) {
      teardown(s)
      WatchBus.isRunning = false
      WatchBus.emit("onWatchStopped", mapOf("reason" to "destroyed", "ts" to System.currentTimeMillis()))
    }
    OverlayController.hide()
    super.onDestroy()
  }

  // --- Notification -----------------------------------------------------------------------

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = getSystemService(NotificationManager::class.java) ?: return
    if (nm.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(CHANNEL_ID, "Watching for ride offers", NotificationManager.IMPORTANCE_LOW).apply {
      description = "Shown while RideOffer Copilot is reading ride-offer cards on your screen."
      setShowBadge(false)
    }
    nm.createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val stopIntent = PendingIntent.getService(
      this, 1, Intent(this, ScreenWatchService::class.java).setAction(ACTION_STOP), flags
    )
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val openIntent = launch?.let { PendingIntent.getActivity(this, 2, it, flags) }
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.rideoffer_notification)
      .setContentTitle("Watching for ride offers")
      .setContentText("Offers are read on this phone only. Tap Stop to end.")
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setContentIntent(openIntent)
      .addAction(0, "Stop watching", stopIntent)
      .build()
  }

  companion object {
    private const val TAG = "RideOfferWatch"
    const val ACTION_START = "com.rideoffercopilot.screenwatcher.START"
    const val ACTION_STOP = "com.rideoffercopilot.screenwatcher.STOP"
    const val EXTRA_RESULT_CODE = "resultCode"
    const val EXTRA_RESULT_DATA = "resultData"
    private const val CHANNEL_ID = "rideoffer_watching"
    private const val NOTIFICATION_ID = 4711
    private const val MAX_CAPTURE_SHORT_EDGE = 1080f
    private const val FRAME_INTERVAL_MS = 600L
    private const val MIN_GAP_MS = 120L
  }
}
