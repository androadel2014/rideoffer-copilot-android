import type { OfferRecord } from '../engine/records';
import type { SyncOutcome } from '../sync/payload';
import { createStore } from './createStore';

export type WatchStatus = 'idle' | 'requesting' | 'watching' | 'stopping';

export interface SessionStats {
  offers: number;
  great: number;
  ok: number;
  bad: number;
  unreadable: number;
}

export interface AppState {
  watchStatus: WatchStatus;
  sessionId: number | null;
  sessionStartedAt: number | null;
  stats: SessionStats;
  lastOffer: OfferRecord | null;
  /** Start of the currently open wait (ms) or null. */
  waitStartedAt: number | null;
  overlayAllowed: boolean;
  /** Plain-English reason the last session ended, shown once on the Watch screen. */
  stopNotice: string | null;
  sync: {
    lastAttemptAt: number | null;
    lastOutcome: SyncOutcome | null;
    keyRejected: boolean;
    pending: number;
    busy: boolean;
  };
  historyVersion: number;
}

export const EMPTY_STATS: SessionStats = { offers: 0, great: 0, ok: 0, bad: 0, unreadable: 0 };

export const appStore = createStore<AppState>({
  watchStatus: 'idle',
  sessionId: null,
  sessionStartedAt: null,
  stats: EMPTY_STATS,
  lastOffer: null,
  waitStartedAt: null,
  overlayAllowed: false,
  stopNotice: null,
  sync: { lastAttemptAt: null, lastOutcome: null, keyRejected: false, pending: 0, busy: false },
  historyVersion: 0,
});

export const bumpHistory = () => appStore.set((s) => ({ historyVersion: s.historyVersion + 1 }));
