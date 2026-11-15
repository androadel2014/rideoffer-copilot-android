import { ingestUrl, isValidBaseUrl } from '../config/validate';
import { countUnsynced, listUnsynced, markSynced } from '../db/database';
import { postJson } from '../net/transport';
import { appStore } from '../state/appStore';
import { settingsStore } from '../state/settingsStore';
import { buildBatch, classifyStatus, MAX_BATCH, type SyncOutcome } from './payload';

/**
 * Optional sync. OFF by default. When OFF this module schedules nothing and sends nothing:
 * every entry point checks `isSyncActive()` first, and the network gate refuses requests
 * independently (defense in depth).
 *
 * Grading never waits on sync: callers fire-and-forget `kickSync()`.
 */

const APP_VERSION = '1.0.0';
const INTERVAL_MS = 2 * 60 * 1000;
const KICK_DELAY_MS = 8 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let kickTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<SyncOutcome> | null = null;
let rejectedForKey: string | null = null;

export function isSyncActive(): boolean {
  const s = settingsStore.get().settings.sync;
  return s.enabled && isValidBaseUrl(s.baseUrl) && s.driverKey.length > 0;
}

/** Call whenever settings change. Starts/stops the periodic timer. */
export function configureSync(): void {
  const s = settingsStore.get().settings.sync;
  if (rejectedForKey != null && rejectedForKey !== s.driverKey) {
    rejectedForKey = null;
    appStore.set((st) => ({ sync: { ...st.sync, keyRejected: false } }));
  }
  if (isSyncActive()) {
    if (!timer) timer = setInterval(() => void syncNow(), INTERVAL_MS);
    kickSync();
  } else {
    if (timer) clearInterval(timer);
    if (kickTimer) clearTimeout(kickTimer);
    timer = null;
    kickTimer = null;
  }
  void refreshPendingCount();
}

export function kickSync(): void {
  if (!isSyncActive()) return;
  if (kickTimer) return;
  kickTimer = setTimeout(() => {
    kickTimer = null;
    void syncNow();
  }, KICK_DELAY_MS);
}

export async function refreshPendingCount(): Promise<void> {
  try {
    const pending = await countUnsynced();
    appStore.set((st) => ({ sync: { ...st.sync, pending } }));
  } catch {
    /* ignore */
  }
}

/** One batch (≤200 records). Never throws. */
export function syncNow(opts: { manual?: boolean } = {}): Promise<SyncOutcome> {
  if (inFlight) return inFlight;
  inFlight = run(opts.manual === true).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(manual: boolean): Promise<SyncOutcome> {
  if (!isSyncActive()) return { kind: 'disabled' };
  const { settings } = settingsStore.get();
  const key = settings.sync.driverKey;
  // After a 401, stop retrying automatically until the key changes or the user taps "Sync now".
  if (!manual && rejectedForKey === key) return { kind: 'key_rejected' };

  appStore.set((st) => ({ sync: { ...st.sync, busy: true } }));
  let outcome: SyncOutcome;
  try {
    const { offers, waits } = await listUnsynced(MAX_BATCH);
    const batch = buildBatch(offers, waits, { driverId: settings.driverId, appVersion: APP_VERSION, now: Date.now() });
    if (!batch) {
      outcome = { kind: 'nothing' };
    } else {
      const res = await postJson(ingestUrl(settings.sync.baseUrl), batch.payload, { 'X-Driver-Key': key });
      const kind = classifyStatus(res.status);
      if (kind === 'synced') {
        await markSynced(batch.offerIds, batch.waitIds);
        rejectedForKey = null;
        outcome = { kind: 'synced', count: batch.offerIds.length + batch.waitIds.length };
      } else if (kind === 'key_rejected') {
        rejectedForKey = key;
        outcome = { kind: 'key_rejected' };
      } else {
        outcome = { kind: 'failed', message: `Server answered HTTP ${res.status}` };
      }
    }
  } catch (e: any) {
    const msg = e?.name === 'AbortError' ? 'Timed out' : e?.name === 'NetworkBlockedError' ? 'Blocked (sync off)' : 'No connection';
    outcome = { kind: 'failed', message: msg };
  }
  appStore.set((st) => ({
    sync: {
      ...st.sync,
      busy: false,
      lastAttemptAt: Date.now(),
      lastOutcome: outcome,
      keyRejected: outcome.kind === 'key_rejected' ? true : outcome.kind === 'synced' ? false : st.sync.keyRejected,
    },
  }));
  await refreshPendingCount();
  // Drain a backlog in consecutive batches.
  if (outcome.kind === 'synced' && appStore.get().sync.pending > 0) kickSync();
  return outcome;
}
