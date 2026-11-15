import { DEFAULT_SETTINGS, type AppSettings } from './defaults';
import type { GradingSettings } from '../engine/types';

const num = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const str = (v: unknown, fallback: string, maxLen = 300): string =>
  typeof v === 'string' ? v.trim().slice(0, maxLen) : fallback;

/** Coerces anything (old versions, hand-edited JSON) into a valid settings object. */
export function normalizeSettings(input: unknown): AppSettings {
  const d = DEFAULT_SETTINGS;
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, any>;
  const g = (i.grading ?? {}) as Record<string, unknown>;
  const dg = d.grading;
  const grading: GradingSettings = {
    costPerMile: num(g.costPerMile, dg.costPerMile, 0, 3),
    greatMinNetPerMile: num(g.greatMinNetPerMile, dg.greatMinNetPerMile, 0, 20),
    greatMinNetPerHour: num(g.greatMinNetPerHour, dg.greatMinNetPerHour, 0, 500),
    badBelowNetPerMile: num(g.badBelowNetPerMile, dg.badBelowNetPerMile, 0, 20),
    badBelowNetPerHour: num(g.badBelowNetPerHour, dg.badBelowNetPerHour, 0, 500),
    deadZoneExtraMinutes: num(g.deadZoneExtraMinutes, dg.deadZoneExtraMinutes, 0, 240),
    deadZoneExtraMiles: num(g.deadZoneExtraMiles, dg.deadZoneExtraMiles, 0, 200),
    longTripMinutes: num(g.longTripMinutes, dg.longTripMinutes, 5, 600),
    longTripMiles: num(g.longTripMiles, dg.longTripMiles, 1, 500),
    longPickupMinutes: num(g.longPickupMinutes, dg.longPickupMinutes, 1, 120),
    lowRatingBelow: num(g.lowRatingBelow, dg.lowRatingBelow, 1, 5),
    addSeparateBonus: typeof g.addSeparateBonus === 'boolean' ? g.addSeparateBonus : dg.addSeparateBonus,
    assumedAvgMph: num(g.assumedAvgMph, dg.assumedAvgMph, 5, 70),
  };
  // Keep tiers coherent: "bad" thresholds can never exceed "great" thresholds.
  grading.badBelowNetPerMile = Math.min(grading.badBelowNetPerMile, grading.greatMinNetPerMile);
  grading.badBelowNetPerHour = Math.min(grading.badBelowNetPerHour, grading.greatMinNetPerHour);

  const o = (i.overlay ?? {}) as Record<string, unknown>;
  const s = (i.sync ?? {}) as Record<string, unknown>;
  return {
    grading,
    overlay: {
      seconds: Math.round(num(o.seconds, d.overlay.seconds, 2, 30)),
      position: o.position === 'center' ? 'center' : 'top',
    },
    driverId: str(i.driverId, d.driverId, 64),
    sync: {
      enabled: s.enabled === true,
      baseUrl: normalizeBaseUrl(str(s.baseUrl, '', 300)),
      driverKey: str(s.driverKey, '', 300),
    },
  };
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** Sync requires https (cleartext is disabled at the OS level too). */
export function isValidBaseUrl(url: string): boolean {
  return /^https:\/\/[a-z0-9.-]+(:\d{2,5})?(\/[\w./-]*)?$/i.test(normalizeBaseUrl(url));
}

export function ingestUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/api/rideoffer/v1/ingest`;
}
