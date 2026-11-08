package com.rideoffercopilot.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class DriverPrefs(context: Context) {
    private val prefs = context.getSharedPreferences("rideoffer.settings.v1",Context.MODE_PRIVATE)
    private val keyPrefs = context.getSharedPreferences("rideoffer.secrets.v1",Context.MODE_PRIVATE)
    private fun d(k: String, default: Double) = prefs.getString(k,null)?.toDoubleOrNull() ?: default
    private fun b(k: String, default: Boolean) = prefs.getBoolean(k,default)
    fun load() = DriverSettings(
        greenDollarsPerMile=d("greenDollarsPerMile",1.25),
        greenDollarsPerHour=d("greenDollarsPerHour",30.0),
        redDollarsPerMile=d("redDollarsPerMile",0.90),
        redDollarsPerHour=d("redDollarsPerHour",20.0),
        runningCostPerMile=d("runningCostPerMile",0.20),
        longTripOneWayMiles=d("longTripOneWayMiles",75.0),
        deadZoneExtraMinutes=d("deadZoneExtraMinutes",25.0),
        deadZoneExtraMiles=d("deadZoneExtraMiles",8.0),
        driverID=prefs.getString("driverID","driver-1") ?: "driver-1",
        voiceEnabled=b("voiceEnabled",true),uberEnabled=b("uberEnabled",true),lyftEnabled=b("lyftEnabled",true),
        syncEnabled=b("syncEnabled",false),
        syncServerBaseURL=prefs.getString("syncServerBaseURL","https://answerforu.com") ?: "https://answerforu.com"
    )
    fun save(s: DriverSettings) {
        require(s.valid()) { "Invalid thresholds, cost, penalty or driver ID." }
        prefs.edit().apply {
            putString("greenDollarsPerMile",s.greenDollarsPerMile.toString());putString("greenDollarsPerHour",s.greenDollarsPerHour.toString())
            putString("redDollarsPerMile",s.redDollarsPerMile.toString());putString("redDollarsPerHour",s.redDollarsPerHour.toString())
            putString("runningCostPerMile",s.runningCostPerMile.toString());putString("longTripOneWayMiles",s.longTripOneWayMiles.toString())
            putString("deadZoneExtraMinutes",s.deadZoneExtraMinutes.toString());putString("deadZoneExtraMiles",s.deadZoneExtraMiles.toString())
            putString("driverID",s.driverID);putBoolean("voiceEnabled",s.voiceEnabled)
            putBoolean("uberEnabled",s.uberEnabled);putBoolean("lyftEnabled",s.lyftEnabled)
            putBoolean("syncEnabled",s.syncEnabled);putString("syncServerBaseURL",s.syncServerBaseURL)
        }.apply()
    }
    var lastSyncStatus: String
        get()=prefs.getString("lastSyncStatus","Never synced") ?: "Never synced"
        set(value) {prefs.edit().putString("lastSyncStatus",value).apply()}

    private fun secretKey(): SecretKey {
        val alias="rideoffer.driverkey.aesgcm.v1"
        val store=KeyStore.getInstance("AndroidKeyStore").apply {load(null)}
        val existing=store.getKey(alias,null) as? SecretKey
        if(existing!=null) return existing
        val generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).setKeySize(256).build())
        return generator.generateKey()
    }
    /** Encrypted at rest with a non-exportable Android Keystore AES key. Never logged/exported. */
    fun setDriverKey(plain: String) {
        if(plain.isEmpty()) {keyPrefs.edit().remove("cipher").remove("iv").apply();return}
        val cipher=Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE,secretKey())
        val encrypted=cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        keyPrefs.edit().putString("cipher",Base64.encodeToString(encrypted,Base64.NO_WRAP))
            .putString("iv",Base64.encodeToString(cipher.iv,Base64.NO_WRAP)).apply()
    }
    fun getDriverKey(): String? { return try {
        val content=keyPrefs.getString("cipher",null) ?: return null
        val iv=keyPrefs.getString("iv",null) ?: return null
        val cipher=Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE,secretKey(),GCMParameterSpec(128,Base64.decode(iv,Base64.NO_WRAP)))
        String(cipher.doFinal(Base64.decode(content,Base64.NO_WRAP)),Charsets.UTF_8)
    } catch (_: Exception) {null}
    }
}
