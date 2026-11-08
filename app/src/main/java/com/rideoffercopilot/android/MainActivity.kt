package com.rideoffercopilot.android

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.speech.tts.TextToSpeech
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.Locale
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class MainActivity : ComponentActivity() {
    private var pendingUri by mutableStateOf<Uri?>(null)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        pendingUri=sharedUri(intent)
        setContent { MaterialCopilot(pendingUri, onConsumed={pendingUri=null}) }
    }
    override fun onResume() {
        super.onResume()
        LiveWatchState.refreshPermissions()
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pendingUri=sharedUri(intent)
    }
    @Suppress("DEPRECATION")
    private fun sharedUri(intent: Intent?): Uri? {
        if(intent?.action!=Intent.ACTION_SEND || intent.type?.startsWith("image/")!=true) return null
        return intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM) ?: intent.clipData?.getItemAt(0)?.uri
    }
}

class VoiceSpeaker(context: android.content.Context) : TextToSpeech.OnInitListener {
    private var ready=false
    private var pending: String?=null
    private val tts=TextToSpeech(context.applicationContext,this)
    override fun onInit(status: Int) {
        ready=status==TextToSpeech.SUCCESS
        if(ready) {tts.language=Locale.US;pending?.let {speak(it)};pending=null}
    }
    fun speak(text: String) {
        if(!ready) {pending=text;return}
        tts.speak(text,TextToSpeech.QUEUE_FLUSH,null,"rideoffer-verdict")
    }
    fun shutdown() {tts.stop();tts.shutdown()}
}

class RideController(context: android.content.Context) {
    val prefs=DriverPrefs(context.applicationContext)
    val database=OfferDatabase(context.applicationContext)
    val zones: ZoneConfig = JSONObject(context.assets.open("Zones.json").bufferedReader().use {it.readText()}).let {j->
        fun strings(key: String): List<String> = j.getJSONArray(key).let{ a -> (0 until a.length()).map {a.getString(it)} }
        ZoneConfig(j.getInt("version"),strings("hot"),strings("neutral"),strings("dead"))
    }
    var settings by mutableStateOf(prefs.load())
        private set
    var currentOffer by mutableStateOf<OfferRecord?>(null)
        private set
    var page by mutableStateOf("home")
    var busy by mutableStateOf(false)
        private set
    var error by mutableStateOf("")
        private set
    var offers by mutableStateOf(listOf<OfferRecord>())
        private set
    var waits by mutableStateOf(listOf<WaitRecord>())
        private set
    var lastSync by mutableStateOf(prefs.lastSyncStatus)
        private set
    var settingsError by mutableStateOf("")
        private set
    fun refresh() {offers=database.offers();waits=database.waits()}
    fun currentOfferFromLive(offer: OfferRecord) {currentOffer=offer;page="verdict"}
    fun showError(message: String) { error=message; page="error" }
    fun saveSettings(proposed: DriverSettings, newKey: String): Boolean {
        if(!proposed.valid()) {settingsError="Invalid values. Green must be ≥ red; all values must be finite and nonnegative; driver ID 1–128 chars.";return false}
        if(proposed.syncEnabled && !proposed.syncServerBaseURL.startsWith("https://",true)) {
            settingsError="Sync URL must use HTTPS.";return false
        }
        try {
            if(newKey.isNotBlank()) prefs.setDriverKey(newKey)
            prefs.save(proposed)
            settings=proposed
            settingsError="Saved"
            return true
        } catch (e: Exception) {settingsError="Save failed: ${e.message}";return false}
    }
    fun clearKey() {try{prefs.setDriverKey("");settingsError="Driver key cleared"}catch (_: Exception){settingsError="Cannot clear key"}}
    suspend fun sync() {
        // Both UI trigger and service independently guard against sync OFF.
        if(!prefs.load().syncEnabled) {lastSync="Sync disabled";return}
        lastSync="Sync in progress…"
        val status=withContext(Dispatchers.IO) {SyncService(prefs,database).syncNow()}
        prefs.lastSyncStatus=status
        lastSync=status
    }
    suspend fun syncOnOpen() { if(prefs.load().syncEnabled) sync() }
    suspend fun importImage(context: android.content.Context, uri: Uri) {
        busy=true;page="home";error=""
        try {
            val lines=recognize(context,uri)
            val candidate=OfferParser.scan(lines) ?: run { showError("Couldn't read this card. Check that the fare and trip miles/minutes are visible.");return }
            if((candidate.platform=="Uber" && !settings.uberEnabled) || (candidate.platform=="Lyft" && !settings.lyftEnabled)) {
                showError("${candidate.platform} is disabled in Settings.");return
            }
            val verdict=DecisionEngine.decide(candidate,settings,zones) ?: run {
                showError("Couldn't validate the numbers on this offer. Nothing was saved.");return
            }
            withContext(Dispatchers.IO) {database.addOffer(verdict)}
            currentOffer=verdict;refresh();page="verdict"
        } catch (e: Exception) {showError("Import failed: ${e.message ?: "Unknown error"}. Nothing was saved.")}
        finally {busy=false}
    }
    private suspend fun recognize(context: android.content.Context, uri: Uri): List<OcrLine> {
        val bitmap=withContext(Dispatchers.IO) {
            val options=BitmapFactory.Options().apply {inJustDecodeBounds=true}
            context.contentResolver.openInputStream(uri)?.use {BitmapFactory.decodeStream(it,null,options)}
            val longest=maxOf(options.outWidth,options.outHeight)
            var sample=1
            while(longest/sample > 3600) sample *= 2
            val decoded=BitmapFactory.Options().apply {inSampleSize=sample}
            context.contentResolver.openInputStream(uri)?.use {BitmapFactory.decodeStream(it,null,decoded)}
                ?: throw IllegalArgumentException("Cannot decode the selected image")
        }
        val client=TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        try {
            val recognized=suspendCancellableCoroutine<com.google.mlkit.vision.text.Text> { c ->
                client.process(InputImage.fromBitmap(bitmap,0))
                    .addOnSuccessListener {if(c.isActive)c.resume(it)}
                    .addOnFailureListener {if(c.isActive)c.resumeWithException(it)}
                    .addOnCanceledListener {c.cancel()}
            }
            return recognized.textBlocks.flatMap {b -> b.lines.mapNotNull {l ->
                val rect=l.boundingBox ?: return@mapNotNull null
                OcrLine(l.text,rect.top,rect.height(),rect.left)
            }}.sortedWith(compareBy<OcrLine> {it.y}.thenBy {it.x})
        } finally {client.close();bitmap.recycle()}
    }
    fun setOutcome(outcome: String) {
        val old=currentOffer ?: return
        currentOffer=database.updateOutcome(old.id,outcome)
        refresh()
    }
    fun discard() {currentOffer?.let {database.deleteOffer(it.id)};currentOffer=null;refresh();page="home"}
    fun deleteAll() {database.deleteAll();currentOffer=null;refresh()}
}
