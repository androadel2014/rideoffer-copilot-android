package com.rideoffercopilot.android

import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.graphics.Point
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.*
import android.speech.tts.TextToSpeech
import android.view.WindowManager
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.min

/** One user-authorized MediaProjection session; no Accessibility API, no remote OCR.
 * Screen frames are ephemeral: only sanitized card text and verdicts enter SQLite.
 */
class LiveWatchService : Service() {
    companion object {
        const val ACTION_START = "com.rideoffercopilot.android.START_LIVE"
        const val ACTION_STOP = "com.rideoffercopilot.android.STOP_LIVE"
        const val EXTRA_RESULT_CODE = "capture_result_code"
        const val EXTRA_CAPTURE_DATA = "capture_data"
        private const val SERVICE_NOTIFICATION = 2101
        private const val VERDICT_NOTIFICATION = 2102
        private const val SERVICE_CHANNEL = "rideoffer_live_session"
        private const val VERDICT_CHANNEL = "rideoffer_live_verdict"
        private const val INTERVAL_MS = 2000L
    }

    private val handler = Handler(Looper.getMainLooper())
    private var frameThread: HandlerThread? = null
    private var frameHandler: Handler? = null
    private var imageReader: ImageReader? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var projection: MediaProjection? = null
    private var recognizer: TextRecognizer? = null
    private var overlay: LiveOverlay? = null
    private var speaker: VoiceSpeaker? = null
    private val busy = AtomicBoolean(false)
    private val stopping = AtomicBoolean(false)
    private val dedup = LiveOfferDedup()
    private var lastFrameAt = 0L
    private var lastFrameHash: Long? = null
    private var lastOcrAt = 0L
    private lateinit var prefs: DriverPrefs
    private lateinit var db: OfferDatabase
    private lateinit var zones: ZoneConfig
    private lateinit var power: PowerManager

    override fun onCreate() {
        super.onCreate()
        prefs = DriverPrefs(this)
        db = OfferDatabase(this)
        zones = ZoneConfigLoader.load(this)
        power = getSystemService(POWER_SERVICE) as PowerManager
        overlay = LiveOverlay(this)
        createChannels()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { stopWatch("Stopped by driver"); return START_NOT_STICKY }
        if (intent?.action != ACTION_START || projection != null) return START_NOT_STICKY
        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
        @Suppress("DEPRECATION")
        val captureData: Intent? = if (Build.VERSION.SDK_INT >= 33)
            intent.getParcelableExtra(EXTRA_CAPTURE_DATA, Intent::class.java)
        else intent.getParcelableExtra(EXTRA_CAPTURE_DATA)
        if (resultCode != Activity.RESULT_OK || captureData == null) {
            LiveWatchState.stopped("Screen capture permission not granted")
            stopSelf(); return START_NOT_STICKY
        }
        try {
            // Mandatory for target SDK 36: start an FGS of type mediaProjection BEFORE getMediaProjection.
            val notification = serviceNotification()
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(SERVICE_NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
            } else startForeground(SERVICE_NOTIFICATION, notification)
            val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            projection = manager.getMediaProjection(resultCode, captureData)
                ?: throw IllegalStateException("MediaProjection denied")
            frameThread = HandlerThread("RideOffer-Frames").also { it.start() }
            frameHandler = Handler(frameThread!!.looper)
            recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
            projection!!.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() { handler.post { stopWatch("Capture stopped by Android") } }
                // Android 14+ can change the captured content's size without requiring new consent.
                override fun onCapturedContentResize(width: Int, height: Int) {
                    handler.post { if (!stopping.get() && width > 0 && height > 0) resizeCapture(width,height) }
                }
            }, handler)
            val screen = Point()
            @Suppress("DEPRECATION")
            (getSystemService(WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealSize(screen)
            setupDisplay(screen.x, screen.y)
            stopping.set(false)
            LiveWatchState.started()
        } catch (e: Exception) {
            stopWatch("Unable to start capture: ${e.message ?: "permission error"}")
        }
        return START_NOT_STICKY // never recreate without a fresh user consent token
    }

    private fun setupDisplay(width: Int, height: Int) {
        if (width <= 0 || height <= 0) return
        // Cap capture resolution for battery/RAM without cropping any offer-sheet content.
        val scale = min(1.0, 1080.0 / width)
        val w = (width * scale).toInt().coerceAtLeast(1)
        val h = (height * scale).toInt().coerceAtLeast(1)
        val oldReader = imageReader
        val next = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2)
        next.setOnImageAvailableListener({ source -> consume(source) }, frameHandler)
        val dpi = resources.displayMetrics.densityDpi
        try {
            if (virtualDisplay == null) {
                virtualDisplay = projection?.createVirtualDisplay("RideOffer-LiveWatch", w, h, dpi,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, next.surface, null, frameHandler)
            } else {
                virtualDisplay?.resize(w,h,dpi)
                virtualDisplay?.setSurface(next.surface)
            }
            imageReader = next
            oldReader?.setOnImageAvailableListener(null,null)
            oldReader?.close()
            lastFrameHash = null
            lastOcrAt = 0L
        } catch (e: Exception) { next.close(); throw e }
    }

    private fun resizeCapture(width: Int, height: Int) {
        // Resize the EXISTING virtual display. Never call createVirtualDisplay twice per consent.
        if (virtualDisplay != null) {
            try { setupDisplay(width,height) }
            catch (_: Exception) { stopWatch("Capture resize failed; restart live watch") }
        }
    }

    private fun consume(reader: ImageReader) {
        val image = try { reader.acquireLatestImage() } catch (_: Exception) { null } ?: return
        try {
            if (stopping.get() || !power.isInteractive || busy.get()) return
            val now = SystemClock.elapsedRealtime()
            if (now-lastFrameAt < INTERVAL_MS) return
            lastFrameAt=now
            val plane = image.planes.firstOrNull() ?: return
            if (plane.pixelStride != 4) return
            val paddedWidth = plane.rowStride / plane.pixelStride
            if (paddedWidth < image.width || paddedWidth <= 0) return
            val buffer = plane.buffer
            buffer.rewind()
            val padded = Bitmap.createBitmap(paddedWidth,image.height,Bitmap.Config.ARGB_8888)
            try { padded.copyPixelsFromBuffer(buffer) } catch (_: Exception) { padded.recycle();return }
            val visible = Bitmap.createBitmap(padded,0,0,image.width,image.height)
            padded.recycle()
            // Uber/Lyft offer cards are bottom sheets: do not run OCR on the top navigation/map.
            val cropTop = (visible.height * 0.34f).toInt()
            val card = Bitmap.createBitmap(visible,0,cropTop,visible.width,visible.height-cropTop)
            visible.recycle()
            val maxDim = maxOf(card.width,card.height)
            val resized = if (maxDim > 1900) {
                val ratio = 1900.0/maxDim
                Bitmap.createScaledBitmap(card,(card.width*ratio).toInt().coerceAtLeast(1),
                    (card.height*ratio).toInt().coerceAtLeast(1),true).also {card.recycle()}
            } else card
            val hash = frameHash(resized)
            // Force a periodic OCR refresh even if the coarse hash misses small text changes.
            if (lastFrameHash == hash && now - lastOcrAt < 8000L) {resized.recycle();return}
            lastFrameHash = hash
            lastOcrAt = now
            busy.set(true)
            val client = recognizer ?: run { resized.recycle();busy.set(false);return }
            client.process(InputImage.fromBitmap(resized,0))
                .addOnSuccessListener { text ->
                    val lines = text.textBlocks.flatMap { block -> block.lines.mapNotNull { line ->
                        val bounds=line.boundingBox ?: return@mapNotNull null
                        OcrLine(line.text,bounds.top,bounds.height(),bounds.left)
                    }}
                    analyze(lines)
                }
                .addOnFailureListener { dedup.onNoOffer() }
                .addOnCompleteListener { resized.recycle();busy.set(false) }
        } finally {image.close()}
    }

    /** Cheap coarse frame fingerprint. OCR only when the lower card area changes. */
    private fun frameHash(bitmap: Bitmap): Long {
        var hash = 1125899906842597L
        for (row in 0 until 12) for (col in 0 until 10) {
            val x = min(bitmap.width-1,(col*bitmap.width+bitmap.width/2)/10)
            val y = min(bitmap.height-1,(row*bitmap.height+bitmap.height/2)/12)
            val pixel=bitmap.getPixel(x,y)
            hash = 31L * hash + ((pixel shr 4) and 0x00f0f0f0).toLong()
        }
        return hash
    }

    private fun analyze(lines: List<OcrLine>) {
        if (stopping.get()) return
        if (!LiveOfferGate.looksLikeOffer(lines)) { dedup.onNoOffer(); return }
        val candidate = OfferParser.scan(lines) ?: run {dedup.onNoOffer();return}
        val settings = prefs.load()
        if ((candidate.platform=="Uber" && !settings.uberEnabled) ||
            (candidate.platform=="Lyft" && !settings.lyftEnabled)) {dedup.onNoOffer();return}
        val graded = DecisionEngine.decide(candidate, settings, zones) ?: run {dedup.onNoOffer();return}
        if (!dedup.shouldLog(candidate,SystemClock.elapsedRealtime())) return
        try {
            // OfferParser already applies CardPrivacy.sanitize; never persist bitmap bytes.
            db.addOffer(graded)
        } catch (_: Exception) { LiveWatchState.stopped("Couldn't save offer; restart live watch"); stopWatch("Storage error");return }
        LiveWatchState.found(graded)
        if (settings.voiceEnabled) {
            if (speaker == null) speaker = VoiceSpeaker(this)
            speaker?.speak("${if(graded.verdict=="green") "Accept" else "Skip"}. " +
                String.format(Locale.US,"Net %.2f dollars per mile, %.2f dollars per hour. ", graded.netDollarsPerMile,graded.netDollarsPerHour) +
                (if(graded.longTripReturnMiles!=null && graded.longTripReturnMiles>0) "Long trip, empty return. " else "") +
                (if(graded.zoneTier=="dead") "Dead-zone dropoff." else ""))
        }
        if (overlay?.show(graded) != true) postVerdictNotification(graded)
    }

    private fun createChannels() {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(NotificationChannel(SERVICE_CHANNEL,"Live watch",NotificationManager.IMPORTANCE_LOW).apply {
            description="Screen capture session and Stop control"
        })
        manager.createNotificationChannel(NotificationChannel(VERDICT_CHANNEL,"Offer verdicts",NotificationManager.IMPORTANCE_HIGH).apply {
            description="Offer alerts when the floating badge isn't available"
        })
    }

    private fun serviceNotification(): Notification {
        val stopIntent = Intent(this,LiveWatchService::class.java).apply {action=ACTION_STOP}
        val stop = PendingIntent.getService(this,11,stopIntent,PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val open = PendingIntent.getActivity(this,12,Intent(this,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return Notification.Builder(this,SERVICE_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("RideOffer · Live watch active")
            .setContentText("Watching for Uber/Lyft offer cards · tap Stop to end")
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(android.R.drawable.ic_media_pause,"Stop",stop).build())
            .build()
    }

    private fun postVerdictNotification(record: OfferRecord) {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val open = PendingIntent.getActivity(this,20,Intent(this,MainActivity::class.java),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val title = if (record.verdict=="green") "ACCEPT · ${record.platform}" else "SKIP · ${record.platform}"
        val message = String.format(Locale.US, "NET $%.2f/mi · $%.2f/hr. %s",record.netDollarsPerMile,record.netDollarsPerHour,record.reasons)
        try {
            val notification = Notification.Builder(this,VERDICT_CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title).setContentText(message)
                .setStyle(Notification.BigTextStyle().bigText(message))
                .setContentIntent(open).setAutoCancel(true).build()
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(VERDICT_NOTIFICATION,notification)
        } catch (_: SecurityException) { }
    }

    private fun stopWatch(reason: String) {
        if (!stopping.compareAndSet(false,true)) return
        imageReader?.setOnImageAvailableListener(null,null)
        virtualDisplay?.release();virtualDisplay=null
        imageReader?.close();imageReader=null
        projection?.stop();projection=null
        recognizer?.close();recognizer=null
        overlay?.hide();overlay=null
        speaker?.shutdown();speaker=null
        frameThread?.quitSafely();frameThread=null;frameHandler=null
        busy.set(false)
        dedup.reset()
        LiveWatchState.stopped(reason)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        stopWatch("Stopped")
        super.onDestroy()
    }
}

/** Explicit loader makes service and UI use exactly the same zone keywords. */
object ZoneConfigLoader {
    fun load(context: Context): ZoneConfig {
        val j = org.json.JSONObject(context.assets.open("Zones.json").bufferedReader().use { it.readText() })
        fun strings(key: String) = j.getJSONArray(key).let { a -> (0 until a.length()).map {a.getString(it)} }
        return ZoneConfig(j.getInt("version"),strings("hot"),strings("neutral"),strings("dead"))
    }
}
