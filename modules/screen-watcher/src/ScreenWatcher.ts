import { requireOptionalNativeModule } from 'expo-modules-core';

/** One OCR line, coordinates normalized (0..1) to the detected card box. */
export interface CardLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CardEventPayload {
  ts: number;
  text: string;
  linesJson: string;
  cardTop: number;
  cardBottom: number;
  frameWidth: number;
  frameHeight: number;
  pass: 'crop' | 'frame';
  /** vc12: sequence number of this card on screen. Send it back with the verdict. */
  cardSeq?: number;
}

export type ScreenState = 'started' | 'offer' | 'trip' | 'idle' | 'other';

export interface StartResult {
  granted: boolean;
  /** '' when granted; otherwise denied | superseded | no_activity | launch_failed | timeout | ... */
  reason: string;
}

/** Overlay content: two headline numbers lead (net $/hr, net ¢/mi); verdict + reason support them. */
export interface OverlayPayload {
  hour: string;
  mile: string;
  hourLabel: string;
  mileLabel: string;
  verdict: string;
  reason: string;
  /** Flags, may be empty. */
  detail: string;
  /** "$18.42 · 15.4 mi · 27 min total". */
  meta: string;
  /** "★ 4.93" or "". */
  rating: string;
  background: string;
  foreground: string;
  durationMs: number;
  /** "card" floats on top of the detected offer card (anchorTop/anchorBottom), else top/center of screen. */
  position: 'card' | 'top' | 'center';
  /** Offer-card edges as fractions of the screen height; −1 when unknown. */
  anchorTop: number;
  anchorBottom: number;
  /**
   * The card this verdict belongs to (from the onCard event). Omit for previews (Try the
   * grader, Settings), which keep the overlay seconds timer.
   * vc13: a live verdict (with cardSeq) stays until the driver dismisses it (✕ or swipe)
   * or a newer card's verdict replaces it; a verdict for an older card is never drawn.
   */
  cardSeq?: number;
  /** vc13: gross figures shown beside the net ones (src/state/grossNet.ts). */
  grossHour?: string;
  grossMile?: string;
  grossHourLabel?: string;
  grossMileLabel?: string;
  netNote?: string;
}

interface Subscription {
  remove(): void;
}

interface NativeScreenWatcher {
  isSupported(): boolean;
  isWatching(): boolean;
  canDrawOverlays(): boolean;
  openOverlaySettings(): Promise<boolean>;
  openAppSettings(): Promise<boolean>;
  startWatching(): Promise<StartResult>;
  stopWatching(): Promise<boolean>;
  showOverlay(payload: OverlayPayload): Promise<boolean>;
  hideOverlay(): Promise<boolean>;
  addListener(event: string, cb: (payload: any) => void): Subscription;
}

// Optional: in Expo Go / unsupported builds this is null and every call degrades safely.
const Native = requireOptionalNativeModule<NativeScreenWatcher>('ScreenWatcher');

const noop: Subscription = { remove() {} };

export const ScreenWatcher = {
  available: Native != null,

  isSupported(): boolean {
    try {
      return Native?.isSupported() ?? false;
    } catch {
      return false;
    }
  },
  isWatching(): boolean {
    try {
      return Native?.isWatching() ?? false;
    } catch {
      return false;
    }
  },
  canDrawOverlays(): boolean {
    try {
      return Native?.canDrawOverlays() ?? false;
    } catch {
      return false;
    }
  },
  async openOverlaySettings(): Promise<boolean> {
    try {
      return (await Native?.openOverlaySettings()) ?? false;
    } catch {
      return false;
    }
  },
  async openAppSettings(): Promise<boolean> {
    try {
      return (await Native?.openAppSettings()) ?? false;
    } catch {
      return false;
    }
  },
  async startWatching(): Promise<StartResult> {
    if (!Native) return { granted: false, reason: 'native_unavailable' };
    try {
      const r = await Native.startWatching();
      return { granted: !!r?.granted, reason: String(r?.reason ?? '') };
    } catch {
      return { granted: false, reason: 'native_error' };
    }
  },
  async stopWatching(): Promise<void> {
    try {
      await Native?.stopWatching();
    } catch {
      /* already stopped */
    }
  },
  async showOverlay(payload: OverlayPayload): Promise<boolean> {
    try {
      return (await Native?.showOverlay(payload)) ?? false;
    } catch {
      return false;
    }
  },
  async hideOverlay(): Promise<void> {
    try {
      await Native?.hideOverlay();
    } catch {
      /* ignore */
    }
  },

  onCard(cb: (e: CardEventPayload) => void): Subscription {
    return Native?.addListener('onCard', cb) ?? noop;
  },
  onScreenState(cb: (e: { state: ScreenState; ts: number }) => void): Subscription {
    return Native?.addListener('onScreenState', cb) ?? noop;
  },
  onWatchStopped(cb: (e: { reason: string; ts: number }) => void): Subscription {
    return Native?.addListener('onWatchStopped', cb) ?? noop;
  },
  onWatchError(cb: (e: { reason: string; ts: number }) => void): Subscription {
    return Native?.addListener('onWatchError', cb) ?? noop;
  },
};

export function parseCardLines(json: string): CardLine[] {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((l) => l && typeof l.text === 'string')
      .map((l) => ({ text: String(l.text), x: +l.x || 0, y: +l.y || 0, w: +l.w || 0, h: +l.h || 0 }));
  } catch {
    return [];
  }
}
