import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { ScreenWatcher, parseCardLines, type CardEventPayload } from '../../modules/screen-watcher';
import { endSession, insertOffer, insertWait, startSession } from '../db/database';
import { evaluateInput, gradeParsed, toRecord, type Evaluation } from '../engine/evaluate';
import { buildOverlay, cleanAnchor, type OverlayAnchor } from '../engine/overlay';
import type { OfferRecord } from '../engine/records';
import type { ParsedOffer } from '../engine/types';
import { WaitTracker, type ScreenSignal } from '../engine/waitTracker';
import { textToLines } from '../ocr/parser';
import { kickSync, refreshPendingCount } from '../sync/syncService';
import { appStore, bumpHistory, EMPTY_STATS } from './appStore';
import { settingsStore } from './settingsStore';

/**
 * The live pipeline:  native card event → parse (+privacy, currency, units) → market → grade
 *                     → overlay ON the offer card → SQLite → waits → sync kick.
 * The overlay is shown BEFORE anything is written, so storage can never slow the verdict.
 * Every step is guarded: a bad card is logged as unreadable, never a crash.
 */

export type StartOutcome =
  | { ok: true }
  | { ok: false; kind: 'capture_denied' | 'unsupported' | 'error'; reason: string };

const DEDUP_WINDOW_MS = 25_000;
let initialized = false;
let lastKey: { key: string; ts: number } | null = null;

const tracker = new WaitTracker((w) => {
  const sessionId = appStore.get().sessionId;
  appStore.set({ waitStartedAt: null });
  insertWait({ ...w, sessionId }).then(bumpHistory, () => undefined);
  kickSync();
});

function syncWaitClock() {
  const open = tracker.openWait;
  appStore.set({ waitStartedAt: open ? open.startTs : null });
}

const STOP_MESSAGES: Record<string, string> = {
  user: 'Watching stopped from the notification.',
  system: 'Android stopped screen sharing (for example the screen locked or you tapped "Stop sharing"). Tap Start Watching to resume.',
  app_closed: 'Watching stopped because the app was closed.',
  error: 'Watching stopped because screen capture failed. Tap Start Watching to try again.',
  destroyed: 'Watching stopped.',
};

export function initWatchController(): void {
  if (initialized) return;
  initialized = true;

  ScreenWatcher.onCard((e) => {
    void handleCard(e);
  });
  ScreenWatcher.onScreenState((e) => {
    try {
      if (e.state === 'started') return;
      tracker.screen(e.state as ScreenSignal, Number(e.ts) || Date.now());
      syncWaitClock();
    } catch {
      /* ignore */
    }
  });
  ScreenWatcher.onWatchStopped((e) => {
    void finalizeSession(STOP_MESSAGES[e.reason] ?? STOP_MESSAGES.destroyed, false);
  });
  ScreenWatcher.onWatchError(() => {
    /* followed by onWatchStopped("error") */
  });

  refreshOverlayPermission();
  AppState.addEventListener('change', (s) => {
    if (s !== 'active') return;
    refreshOverlayPermission();
    // Reconcile: the service may have been stopped while we were in the background.
    const st = appStore.get();
    if (st.watchStatus === 'watching' && !ScreenWatcher.isWatching()) {
      void finalizeSession(STOP_MESSAGES.system, false);
    }
  });
}

export function refreshOverlayPermission(): boolean {
  const allowed = ScreenWatcher.canDrawOverlays();
  appStore.set({ overlayAllowed: allowed });
  return allowed;
}

async function requestNotificationPermission() {
  // The foreground-service notification is how Android shows that capture is running.
  // If the driver declines, watching still works; the notification is just hidden.
  try {
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as any);
    }
  } catch {
    /* non-fatal */
  }
}

export async function startWatching(): Promise<StartOutcome> {
  const st = appStore.get();
  if (st.watchStatus === 'requesting') return { ok: false, kind: 'error', reason: 'busy' };
  if (!ScreenWatcher.available || !ScreenWatcher.isSupported()) {
    return { ok: false, kind: 'unsupported', reason: ScreenWatcher.available ? 'android_version' : 'native_unavailable' };
  }
  appStore.set({ watchStatus: 'requesting', stopNotice: null });
  await requestNotificationPermission();

  const wasWatching = st.watchStatus === 'watching';
  const result = await ScreenWatcher.startWatching();
  if (!result.granted) {
    // A denied re-grant leaves the existing session (if any) untouched.
    appStore.set({ watchStatus: wasWatching && ScreenWatcher.isWatching() ? 'watching' : 'idle' });
    const kind = result.reason === 'denied' ? 'capture_denied' : 'error';
    return { ok: false, kind, reason: result.reason };
  }
  // Re-grant while already watching: close the previous session cleanly.
  if (wasWatching) {
    appStore.set({ watchStatus: 'watching' });
    await finalizeSession(null, true);
  }

  const now = Date.now();
  let sessionId: number | null = null;
  try {
    sessionId = await startSession(now);
  } catch {
    sessionId = null;
  }
  lastKey = null;
  tracker.start(now);
  appStore.set({
    watchStatus: 'watching',
    sessionId,
    sessionStartedAt: now,
    stats: EMPTY_STATS,
    lastOffer: null,
    waitStartedAt: now,
  });
  return { ok: true };
}

export async function stopWatching(): Promise<void> {
  appStore.set({ watchStatus: 'stopping' });
  await ScreenWatcher.stopWatching();
  // onWatchStopped will also fire; finalizeSession is idempotent.
  await finalizeSession(null, true);
}

async function finalizeSession(notice: string | null, userInitiated: boolean) {
  const st = appStore.get();
  if (st.watchStatus === 'idle' && st.sessionId == null) return;
  const now = Date.now();
  tracker.stop(now);
  if (st.sessionId != null) {
    try {
      await endSession(st.sessionId, now);
    } catch {
      /* ignore */
    }
  }
  appStore.set({
    watchStatus: 'idle',
    sessionId: null,
    waitStartedAt: null,
    stopNotice: userInitiated ? null : notice,
  });
  bumpHistory();
}

// ---------------------------------------------------------------------------------------

export type { Evaluation };
export { toRecord };

export function evaluateCard(text: string, lines = textToLines(text), pass: 'crop' | 'frame' = 'crop'): Evaluation {
  const { settings, zones } = settingsStore.get();
  return evaluateInput({ text, lines, pass }, settings, zones);
}

/** Grades a hand-entered offer (Try the grader) with the same market logic as live offers. */
export function evaluateParsed(parsed: ParsedOffer): Evaluation {
  const { settings, zones } = settingsStore.get();
  return gradeParsed(parsed, settings, zones);
}

/**
 * Shows the verdict over the driver app. With a card anchor (where the offer card sits on
 * screen) and the default "card" position, it floats on top of the offer card itself.
 */
export async function showVerdictOverlay(ev: Evaluation, anchor?: OverlayAnchor | null): Promise<boolean> {
  if (!appStore.get().overlayAllowed && !refreshOverlayPermission()) return false;
  const content = buildOverlay(ev.grade, ev.parsed, settingsStore.get().settings.overlay, ev.fmt, anchor);
  return ScreenWatcher.showOverlay(content);
}

function dedupKey(p: ParsedOffer): string {
  return [p.fare, p.tripMi, p.tripMin, p.pickupMin].map((v) => (v == null ? '?' : String(v))).join('|');
}

async function handleCard(e: CardEventPayload) {
  const st = appStore.get();
  if (st.watchStatus !== 'watching') return;
  const ts = Number(e.ts) || Date.now();
  let ev: Evaluation;
  try {
    const lines = parseCardLines(e.linesJson);
    ev = evaluateCard(e.text ?? '', lines.length ? lines : textToLines(e.text ?? ''), e.pass === 'frame' ? 'frame' : 'crop');
  } catch {
    return;
  }

  // The same card can be re-detected after an OCR jitter; ignore duplicates.
  const key = dedupKey(ev.parsed);
  if (lastKey && lastKey.key === key && ts - lastKey.ts < DEDUP_WINDOW_MS) return;
  lastKey = { key, ts };

  // 1) Verdict first, floating on the offer card where the native layer found it.
  void showVerdictOverlay(ev, cleanAnchor({ top: e.cardTop, bottom: e.cardBottom }));

  // 2) Then bookkeeping.
  tracker.offer(ts, ev.parsed.dropoffArea);
  syncWaitClock();

  const record: Omit<OfferRecord, 'id' | 'synced'> = toRecord(ev, ts, st.sessionId);
  let id = 0;
  try {
    id = await insertOffer(record);
  } catch {
    id = 0;
  }
  const v = ev.grade.verdict;
  appStore.set((s) => ({
    lastOffer: { ...record, id, synced: false },
    stats: {
      offers: s.stats.offers + 1,
      great: s.stats.great + (v === 'GREAT' ? 1 : 0),
      ok: s.stats.ok + (v === 'OK' ? 1 : 0),
      bad: s.stats.bad + (v === 'BAD' ? 1 : 0),
      unreadable: s.stats.unreadable + (v == null ? 1 : 0),
    },
  }));
  bumpHistory();
  void refreshPendingCount();
  kickSync();
}

