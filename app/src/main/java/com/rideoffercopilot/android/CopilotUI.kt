package com.rideoffercopilot.android

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale
import java.time.Instant

private val green = Color(0xFF157B46)
private val amber = Color(0xFFAD6B08)
private val red = Color(0xFFB32C35)
private fun verdictColor(value: String) = when(value){"green"->green;"yellow"->amber;else->red}
private fun money(value: Double) = String.format(Locale.US,"$%.2f",value)
private fun one(value: Double) = String.format(Locale.US,"%.1f",value)
private fun date(ms: Long): String = java.text.SimpleDateFormat("MMM d, yyyy h:mm a",Locale.US).format(java.util.Date(ms))

@Composable
fun MaterialCopilot(sharedImage: Uri?, onConsumed: () -> Unit) {
    val context= LocalContext.current
    val controller= remember {RideController(context.applicationContext)}
    val scope= rememberCoroutineScope()
    val speaker= remember {VoiceSpeaker(context)}
    DisposableEffect(speaker) {onDispose {speaker.shutdown()}}
    LaunchedEffect(Unit) {controller.refresh();controller.syncOnOpen()}
    LaunchedEffect(sharedImage) {
        if(sharedImage!=null) {controller.importImage(context,sharedImage);onConsumed()}
    }
    LaunchedEffect(controller.currentOffer?.id,controller.page) {
        val offer=controller.currentOffer
        if(offer!=null && controller.page=="verdict" && controller.settings.voiceEnabled) {
            val spokenVerdict = when(offer.verdict) {
                "green" -> "Accept"
                "yellow" -> "Borderline"
                else -> "Decline"
            }
            speaker.speak("$spokenVerdict. " +
                "${money(offer.netDollarsPerMile)} net per mile. ${money(offer.netDollarsPerHour)} net per hour. " +
                (if(offer.longTripReturnMiles!=null && offer.longTripReturnMiles>0) "Long trip, empty return assumed. " else "") +
                (if(offer.zoneTier=="dead") "Dead-zone dropoff. " else ""))
        }
    }
    MaterialTheme(colorScheme=lightColorScheme(primary=Color(0xFF255A78),secondary=Color(0xFF286053))) {
        Scaffold(bottomBar={
            if(controller.page!="verdict" && controller.page!="error") NavigationBar {
                for((key,label) in listOf("home" to "Home","history" to "History","settings" to "Settings")) {
                    NavigationBarItem(selected=controller.page==key,onClick={controller.page=key},icon={Text(when(key){"home"->"⌂";"history"->"≡";else->"⚙"},fontSize=23.sp)},label={Text(label)})
                }
            }
        }) { padding ->
            Box(Modifier.padding(padding).fillMaxSize()) {
                when(controller.page) {
                    "home" -> HomeScreen(controller) {uri->scope.launch {controller.importImage(context,uri)}}
                    "verdict" -> controller.currentOffer?.let { VerdictScreen(it,controller) {speaker.speak("${it.verdict.uppercase()}! ${money(it.netDollarsPerMile)} per mile, ${money(it.netDollarsPerHour)} per hour. ${it.reasons}")} }
                    "history" -> HistoryScreen(controller)
                    "settings" -> SettingsScreen(controller) {scope.launch {controller.sync()}}
                    "error" -> FailureScreen(controller)
                }
            }
        }
    }
}

@Composable
private fun HomeScreen(controller: RideController, import: (Uri)->Unit) {
    val picker=rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) {uri ->if(uri!=null)import(uri)}
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),verticalArrangement=Arrangement.spacedBy(20.dp)) {
        Text("RideOffer Copilot",style=MaterialTheme.typography.headlineLarge,fontWeight=FontWeight.Bold)
        Text("Your private Uber + Lyft screenshot analyzer",style=MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.height(22.dp))
        Button(onClick={picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))},
            modifier=Modifier.fillMaxWidth().height(76.dp), enabled=!controller.busy) {
            Text(if(controller.busy)"Reading screenshot…" else "Import offer screenshot",fontSize=19.sp)
        }
        Text("Or open a screenshot in Gallery → Share → RideOffer Copilot.",color=MaterialTheme.colorScheme.onSurfaceVariant)
        HorizontalDivider()
        Text("How it works",style=MaterialTheme.typography.titleLarge)
        Text("1. Take a screenshot of an Uber or Lyft offer.\n2. Share it here or pick it from Gallery.\n3. Review the NET verdict and mark your decision.\n4. Review or export everything in History.")
        Text("All OCR runs on your phone. Screenshots aren't saved here. Sync is off unless you enable it.",color=MaterialTheme.colorScheme.onSurfaceVariant)
        Text("${controller.offers.size} offers logged",style=MaterialTheme.typography.titleMedium)
        if(controller.busy) CircularProgressIndicator()
    }
}

@Composable
private fun VerdictScreen(o: OfferRecord, controller: RideController, speak: ()->Unit) {
    val bg=verdictColor(o.verdict)
    Column(Modifier.fillMaxSize().background(bg).verticalScroll(rememberScrollState()).padding(24.dp),
        horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(14.dp)) {
        Text(when(o.verdict){"green"->"ACCEPT";"yellow"->"BORDERLINE";else->"DECLINE"},
            color=Color.White,fontSize=49.sp,fontWeight=FontWeight.ExtraBold)
        Text("NET after operating cost",color=Color.White)
        Text("${money(o.netDollarsPerMile)} / mi",color=Color.White,fontSize=38.sp,fontWeight=FontWeight.Bold)
        Text("${money(o.netDollarsPerHour)} / hr",color=Color.White,fontSize=34.sp,fontWeight=FontWeight.Bold)
        Text("${o.platform}  ·  Fare ${money(o.fare)}",color=Color.White,fontSize=21.sp)
        Text("Trip: ${one(o.tripMiles)} mi · ${one(o.tripMinutes)} min",color=Color.White)
        Text("Pickup: ${o.pickupMiles?.let(::one)?:"unknown"} mi · ${o.pickupMinutes?.let(::one)?:"unknown"} min",color=Color.White)
        if(o.effectiveMiles!=null) Text("Effective: ${one(o.effectiveMiles)} mi · ${one(o.effectiveMinutes?:0.0)} min",color=Color.White)
        Text(o.reasons,color=Color.White,textAlign=TextAlign.Center)
        if(o.dropoffText!=null) Text("Dropoff: ${o.dropoffText}",color=Color.White,textAlign=TextAlign.Center)
        if(o.surgeIncludedDollars!=null) Text("Includes ${money(o.surgeIncludedDollars)} bonus (not added twice)",color=Color.White)
        Text("OCR pattern scan · verify numbers before deciding",color=Color.White.copy(alpha=0.85f),fontSize=12.sp)
        OutlinedButton(onClick=speak,colors=ButtonDefaults.outlinedButtonColors(containerColor=Color.White)){Text("Speak again")}
        Button(onClick={controller.setOutcome("Accepted (inferred)");controller.page="history"},modifier=Modifier.fillMaxWidth(),colors=ButtonDefaults.buttonColors(containerColor=Color.White,contentColor=bg)) {Text("Mark accepted")}
        Button(onClick={controller.setOutcome("Rejected / expired (inferred)");controller.page="history"},modifier=Modifier.fillMaxWidth(),colors=ButtonDefaults.buttonColors(containerColor=Color.White,contentColor=bg)) {Text("Mark declined")}
        TextButton(onClick={controller.discard()}) {Text("Not an offer / wrong parse — discard",color=Color.White)}
        TextButton(onClick={controller.page="home"}) {Text("Keep pending and go home",color=Color.White)}
    }
}

@Composable
private fun FailureScreen(controller: RideController) {
    Column(Modifier.fillMaxSize().padding(24.dp),verticalArrangement=Arrangement.Center,horizontalAlignment=Alignment.CenterHorizontally) {
        Text("Couldn't read this card",style=MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(16.dp))
        Text(controller.error,textAlign=TextAlign.Center)
        Spacer(Modifier.height(16.dp))
        Text("No offer was saved.")
        Button(onClick={controller.page="home"}) {Text("Try another image")}
    }
}

@Composable
private fun HistoryScreen(controller: RideController) {
    val context=LocalContext.current
    val scope= rememberCoroutineScope()
    var kind by remember {mutableStateOf("offers_csv")}
    val csvExport=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv")) {uri->
        if(uri!=null) scope.launch {withContext(Dispatchers.IO) {
            val data=if(kind=="offers_csv") ExportCodec.offersCSV(controller.offers) else ExportCodec.waitsCSV(controller.waits)
            context.contentResolver.openOutputStream(uri)?.use {it.write(data.toByteArray(Charsets.UTF_8))}
        }}
    }
    val jsonExport=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) {uri->
        if(uri!=null) scope.launch {withContext(Dispatchers.IO) {
            val data=if(kind=="offers_json") ExportCodec.offersJSON(controller.offers) else ExportCodec.waitsJSON(controller.waits)
            context.contentResolver.openOutputStream(uri)?.use {it.write(data.toByteArray(Charsets.UTF_8))}
        }}
    }
    var detail by remember {mutableStateOf<OfferRecord?>(null)}
    var confirmDelete by remember {mutableStateOf(false)}
    var waitsTab by remember {mutableStateOf(false)}
    Column(Modifier.fillMaxSize().padding(14.dp)) {
        Text("History",style=MaterialTheme.typography.headlineLarge,fontWeight=FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            FilterChip(!waitsTab,onClick={waitsTab=false},label={Text("Offers (${controller.offers.size})")})
            FilterChip(waitsTab,onClick={waitsTab=true},label={Text("Waits (${controller.waits.size})")})
        }
        Row(horizontalArrangement=Arrangement.spacedBy(6.dp)) {
            Button(onClick={kind=if(waitsTab)"waits_csv" else "offers_csv";csvExport.launch(if(waitsTab)"ride-waits.csv" else "ride-offers.csv")},modifier=Modifier.weight(1f)) {Text("Export CSV")}
            Button(onClick={kind=if(waitsTab)"waits_json" else "offers_json";jsonExport.launch(if(waitsTab)"ride-waits.json" else "ride-offers.json")},modifier=Modifier.weight(1f)) {Text("Export JSON")}
        }
        OutlinedButton(onClick={confirmDelete=true},modifier=Modifier.fillMaxWidth()) {Text("Delete all history")}
        HorizontalDivider()
        if(waitsTab) LazyColumn(verticalArrangement=Arrangement.spacedBy(8.dp)) {
            items(controller.waits,key={it.id}) {wait -> Card(Modifier.fillMaxWidth()) {Column(Modifier.padding(12.dp)) {
                Text(wait.zoneText);Text(date(wait.startedAt));Text("${wait.durationSeconds ?: "Open"} seconds · ${wait.endedBy ?: "ongoing"}")
            }}}
        } else LazyColumn(verticalArrangement=Arrangement.spacedBy(10.dp)) {
            items(controller.offers,key={it.id}) {offer ->
                Card(Modifier.fillMaxWidth().clickable{detail=offer}) {
                    Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
                        Row(verticalAlignment=Alignment.CenterVertically) {
                            Text("${offer.platform} · ${money(offer.fare)}",fontWeight=FontWeight.Bold,modifier=Modifier.weight(1f))
                            Surface(color=verdictColor(offer.verdict),shape=RoundedCornerShape(6.dp)) {Text(offer.verdict.uppercase(),color=Color.White,modifier=Modifier.padding(horizontal=10.dp,vertical=5.dp))}
                        }
                        Text("${money(offer.netDollarsPerMile)}/mi · ${money(offer.netDollarsPerHour)}/hr")
                        Text("${date(offer.timestamp)} · ${offer.outcome}",color=MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
    if(detail!=null) AlertDialog(onDismissRequest={detail=null},title={Text("Offer details")},
        text={Column(Modifier.heightIn(max=540.dp).verticalScroll(rememberScrollState())) {
            val o=detail!!
            Text("${o.platform} · ${date(o.timestamp)}\nFare ${money(o.fare)} · ${o.verdict.uppercase()}\nNet ${money(o.netDollarsPerMile)}/mi · ${money(o.netDollarsPerHour)}/hr · ${money(o.netDollarsPerMinute)}/min\nTrip ${one(o.tripMiles)}mi/${one(o.tripMinutes)}min · Pickup ${o.pickupMiles?:"?"}mi/${o.pickupMinutes?:"?"}min\nTotal ${one(o.totalMiles)}mi/${one(o.totalMinutes)}min\nEffective ${o.effectiveMiles?:"–"}mi/${o.effectiveMinutes?:"–"}min\nLong return ${o.longTripReturnMiles?:"–"}mi/${o.longTripReturnMinutes?:"–"}min\nDead reposition ${o.deadZoneRepositionMiles?:"–"}mi/${o.deadZoneRepositionMinutes?:"–"}min\nZone ${o.zoneTier}\nRating ${o.riderRating?:"–"}\nSurge included ${o.surgeIncludedDollars?:"–"}; multiplier ${o.surgeMultiplier?:"–"}\nDriver ${o.driverID} · Method ${o.extractionMethod}\nPickup incomplete ${o.assumedPickupMissing}\nOutcome ${o.outcome}\nPickup: ${o.pickupText?:"–"}\nDropoff: ${o.dropoffText?:"–"}\n\n${o.reasons}\n\nRedacted OCR:\n${o.rawText}")
        }},confirmButton={TextButton(onClick={detail=null}){Text("Close")}})
    if(confirmDelete) AlertDialog(onDismissRequest={confirmDelete=false},title={Text("Delete everything?")},
        text={Text("Deletes all offers and waits stored on this phone. Cannot be undone.")},
        confirmButton={TextButton(onClick={controller.deleteAll();confirmDelete=false}){Text("Delete all")}},
        dismissButton={TextButton(onClick={confirmDelete=false}){Text("Cancel")}})
}

@Composable
private fun SettingsScreen(controller: RideController, onSync: ()->Unit) {
    var draft by remember {mutableStateOf(controller.settings)}
    var driverKey by remember {mutableStateOf("")}
    val initial=controller.settings
    val values= remember {mutableStateMapOf(
        "greenMile" to initial.greenDollarsPerMile.toString(),
        "greenHour" to initial.greenDollarsPerHour.toString(),
        "redMile" to initial.redDollarsPerMile.toString(),
        "redHour" to initial.redDollarsPerHour.toString(),
        "cost" to initial.runningCostPerMile.toString(),
        "long" to initial.longTripOneWayMiles.toString(),
        "deadMinutes" to initial.deadZoneExtraMinutes.toString(),
        "deadMiles" to initial.deadZoneExtraMiles.toString()
    )}
    var formError by remember {mutableStateOf("")}
    fun save(): Boolean {
        val nums=values.mapValues {it.value.toDoubleOrNull()}
        if(nums.values.any {it==null}) {formError="Enter valid numeric values in every field.";return false}
        val s=draft.copy(greenDollarsPerMile=nums.getValue("greenMile")!!,
            greenDollarsPerHour=nums.getValue("greenHour")!!,
            redDollarsPerMile=nums.getValue("redMile")!!,redDollarsPerHour=nums.getValue("redHour")!!,
            runningCostPerMile=nums.getValue("cost")!!,longTripOneWayMiles=nums.getValue("long")!!,
            deadZoneExtraMinutes=nums.getValue("deadMinutes")!!,deadZoneExtraMiles=nums.getValue("deadMiles")!!)
        val okay=controller.saveSettings(s,driverKey)
        if(okay){draft=s;driverKey="";formError=""}
        return okay
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
        Text("Settings",style=MaterialTheme.typography.headlineLarge,fontWeight=FontWeight.Bold)
        Text("Thresholds are PROVISIONAL until calibrated from real trips.",color=amber)
        for((key,label) in listOf(
            "greenMile" to "Green floor ($/mile)","greenHour" to "Green floor ($/hour)",
            "redMile" to "Red floor ($/mile)","redHour" to "Red floor ($/hour)",
            "cost" to "Operating cost ($/mile)","long" to "Long trip threshold (one-way miles)",
            "deadMinutes" to "Dead-zone reposition minutes","deadMiles" to "Dead-zone reposition miles"
        )) {
            OutlinedTextField(value=values[key].orEmpty(),onValueChange={values[key]=it},label={Text(label)},
                singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal),modifier=Modifier.fillMaxWidth())
        }
        OutlinedTextField(value=draft.driverID,onValueChange={draft=draft.copy(driverID=it)},label={Text("Driver ID")},modifier=Modifier.fillMaxWidth(),singleLine=true)
        ToggleRow("Speak verdict",draft.voiceEnabled){draft=draft.copy(voiceEnabled=it)}
        ToggleRow("Uber enabled",draft.uberEnabled){draft=draft.copy(uberEnabled=it)}
        ToggleRow("Lyft enabled",draft.lyftEnabled){draft=draft.copy(lyftEnabled=it)}
        HorizontalDivider()
        Text("Data sync (optional)",style=MaterialTheme.typography.titleLarge)
        Text("OFF by default. Enabling sends redacted offer records, addresses and waits to your chosen HTTPS server.",color=MaterialTheme.colorScheme.onSurfaceVariant)
        ToggleRow("Enable sync",draft.syncEnabled){draft=draft.copy(syncEnabled=it)}
        OutlinedTextField(value=draft.syncServerBaseURL,onValueChange={draft=draft.copy(syncServerBaseURL=it)},
            label={Text("Sync server base URL (HTTPS)")},singleLine=true,modifier=Modifier.fillMaxWidth())
        OutlinedTextField(value=driverKey,onValueChange={driverKey=it},label={Text("Driver key (leave blank to keep saved key)")},
            singleLine=true,visualTransformation=PasswordVisualTransformation(),modifier=Modifier.fillMaxWidth())
        OutlinedButton(onClick={controller.clearKey()}){Text("Clear stored driver key")}
        Button(onClick={save()},modifier=Modifier.fillMaxWidth()){Text("Save settings")}
        Button(onClick={if(save())onSync()},enabled=draft.syncEnabled,modifier=Modifier.fillMaxWidth()){Text("Sync now")}
        Text("Last sync: ${controller.lastSync}")
        if(formError.isNotBlank()) Text(formError,color=red)
        if(controller.settingsError.isNotBlank()) Text(controller.settingsError,color=if(controller.settingsError=="Saved")green else amber)
    }
}

@Composable
private fun ToggleRow(label: String,checked: Boolean,changed: (Boolean)->Unit) {
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
        Text(label,modifier=Modifier.weight(1f));Switch(checked=checked,onCheckedChange=changed)
    }
}
