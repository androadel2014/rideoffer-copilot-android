package com.rideoffercopilot.screenwatcher

import java.util.concurrent.atomic.AtomicLong

/**
 * Per-card verdict identity (vc12, revised in vc13).
 *
 * Every card the capture loop emits gets a sequence number (`cardSeq`), and JS sends it
 * back with the verdict.
 *
 * vc13: the verdict is no longer tied to the card being on screen. Once drawn, it stays
 * until the driver dismisses it. The identity rule is now only "newest card wins": a
 * verdict whose card is older than the newest emitted card is never drawn, so a slow
 * verdict can never replace a newer card's verdict.
 *
 * `activeSeq` still tracks whether the card is on screen. The capture loop uses it only
 * to know when the next card is new. It no longer clears the overlay.
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

  /** True when no newer card has been emitted since this one. */
  fun isLatest(seq: Long): Boolean = seq != 0L && seq == counter.get()

  fun reset() {
    activeSeq = 0L
  }
}
