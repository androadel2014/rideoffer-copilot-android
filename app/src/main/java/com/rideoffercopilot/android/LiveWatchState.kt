package com.rideoffercopilot.android

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** In-process foreground-service UI snapshot. SQLite is the durable source of truth. */
object LiveWatchState {
    var running by mutableStateOf(false)
        private set
    var status by mutableStateOf("Not watching")
        private set
    var lastOffer by mutableStateOf<OfferRecord?>(null)
        private set
    var permissionRevision by mutableStateOf(0)
        private set
    fun refreshPermissions() { permissionRevision++ }
    var count by mutableStateOf(0)
        private set

    fun started() { running = true; status = "Watching for Uber / Lyft offers"; count = 0; lastOffer = null }
    fun found(offer: OfferRecord) { lastOffer = offer; count++; status = "Watching · $count offer(s) captured" }
    fun stopped(reason: String = "Not watching") { running = false; status = reason }
}
