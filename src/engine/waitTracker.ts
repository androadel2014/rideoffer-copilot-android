import type { WaitEndedBy, WaitRecord, WaitStartedBy } from './types';

export type ScreenSignal = 'offer' | 'trip' | 'idle' | 'other' | 'started';

type Phase = 'stopped' | 'waiting' | 'offer' | 'trip';

interface OpenWait {
  zoneText: string | null;
  startTs: number;
  startedBy: WaitStartedBy;
}

/**
 * Wait-time state machine (pure; time is injected).
 *
 *   Start Watching ─► WAITING ──offer card──► OFFER ──trip screen──► TRIP
 *                       ▲                       │                     │
 *                       └──── idle (declined) ──┘                     │
 *                       └──────────── idle screen (dropoff) ──────────┘
 *
 * A WAIT record spans "went online" or "dropped off" (or "declined") until the next
 * offer card appears. Zone text is where the driver is waiting: the dropoff area of
 * the last accepted trip, or unknown right after going online.
 */
export class WaitTracker {
  private phase: Phase = 'stopped';
  private open: OpenWait | null = null;
  private lastOfferDropoff: string | null = null;
  private tripDropoff: string | null = null;
  private currentZone: string | null = null;

  constructor(
    private readonly onClosed: (w: WaitRecord) => void,
    private readonly minDurationSec = 3
  ) {}

  get state(): Phase {
    return this.phase;
  }

  get openWait(): Readonly<OpenWait> | null {
    return this.open;
  }

  start(ts: number): void {
    if (this.phase !== 'stopped') this.stop(ts);
    this.phase = 'waiting';
    this.currentZone = null;
    this.openWait_(ts, 'online');
  }

  offer(ts: number, dropoffArea: string | null): void {
    if (this.phase === 'stopped') return;
    this.close(ts, 'offer');
    this.lastOfferDropoff = dropoffArea;
    // An offer that arrives while on a trip (stacked/queued request) keeps us on the trip.
    if (this.phase !== 'trip') this.phase = 'offer';
  }

  screen(signal: ScreenSignal, ts: number): void {
    if (this.phase === 'stopped') return;
    switch (signal) {
      case 'trip':
        if (this.phase === 'offer') {
          this.tripDropoff = this.lastOfferDropoff;
          this.phase = 'trip';
        } else if (this.phase === 'waiting') {
          // Accepted before we saw the card (e.g. card shown while we were busy).
          this.close(ts, 'trip_started');
          this.tripDropoff = null;
          this.phase = 'trip';
        }
        break;
      case 'idle':
        if (this.phase === 'trip') {
          this.currentZone = this.tripDropoff ?? this.currentZone;
          this.phase = 'waiting';
          this.openWait_(ts, 'dropoff');
        } else if (this.phase === 'offer') {
          // Declined or expired: still waiting in the same place.
          this.phase = 'waiting';
          this.openWait_(ts, 'declined');
        }
        break;
      default:
        break;
    }
  }

  stop(ts: number): void {
    if (this.phase === 'stopped') return;
    this.close(ts, 'stopped');
    this.phase = 'stopped';
  }

  private openWait_(ts: number, startedBy: WaitStartedBy) {
    if (this.open) return;
    this.open = { zoneText: this.currentZone, startTs: ts, startedBy };
  }

  private close(ts: number, endedBy: WaitEndedBy) {
    const w = this.open;
    if (!w) return;
    this.open = null;
    const durationSec = Math.max(0, Math.round((ts - w.startTs) / 1000));
    if (durationSec < this.minDurationSec) return;
    this.onClosed({ zoneText: w.zoneText, startTs: w.startTs, durationSec, endedBy, startedBy: w.startedBy });
  }
}
