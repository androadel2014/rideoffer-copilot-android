package com.rideoffercopilot.screenwatcher

import java.util.concurrent.atomic.AtomicLong

/**
 * Which offer card is on screen right now (vc12).
 *
 * Every card the capture loop emits gets a sequence number (`cardSeq`), and JS sends it
 * back with the verdict. The overlay is drawn only while that card is still the active
 * one, so a verdict can never show up after its card has closed. When the capture loop
 * sees the card go, it ends the sequence and the overlay is removed straight away.
 *
 * Written from the capture thread, read from the main thread.
 */
internal object CardPresence {
  private val counter = AtomicLong(0L)

  @Volatile
  var activeSeq: Long = 0L
    private set

  /** A new card is on screen. Returns its sequence number. */
  fun begin(): Long {
    val seq = counter.incrementAndGet()
    activeSeq = seq
    return seq
  }

  /** The card with this sequence number has left the screen. */
  fun end(seq: Long) {
    if (activeSeq == seq) activeSeq = 0L
  }

  fun isActive(seq: Long): Boolean = seq != 0L && seq == activeSeq

  fun reset() {
    activeSeq = 0L
  }
}
