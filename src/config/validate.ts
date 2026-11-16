import { DEFAULT_SETTINGS, SETTINGS_VERSION, type AppSettings } from './defaults';
import {
  CURRENCIES,
  getMarket,
  isMarketCode,
  profileFor,
  ratePerMile,
  US_PROFILE,
  type MarketCode,
  type MarketProfile,
  type MarketSettings,
} from '../engine/market';
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

  // Settings saved before v11 have no `market`: the driver's money settings become the
  // US market profile, unchanged.
  const legacy = i.settingsVersion == null;
  const market = normalizeMarket(i.market, legacy && i.market == null ? legacyProfile(grading) : null);

  const o = (i.overlay ?? {}) as Record<string, unknown>;
  const s = (i.sync ?? {}) as Record<string, unknown>;
  // "top" was the only default before v11; move those drivers onto the new on-card overlay.
  const position: AppSettings['overlay']['position'] =
    o.position === 'center' ? 'center' : o.position === 'top' && !legacy ? 'top' : 'card';
  const out: AppSettings = {
    settingsVersion: SETTINGS_VERSION,
    grading,
    market,
    overlay: {
      seconds: Math.round(num(o.seconds, d.overlay.seconds, 2, 30)),
      position,
    },
    driverId: str(i.driverId, d.driverId, 64),
    sync: {
      enabled: s.enabled === true,
      baseUrl: normalizeBaseUrl(str(s.baseUrl, '', 300)),
      driverKey: str(s.driverKey, '', 300),
    },
  };
  // grading's money fields mirror the home market, per mile.
  out.grading = gradingFor(out, market.home);
  return out;
}

function legacyProfile(g: GradingSettings): MarketProfile | null {
  const p: MarketProfile = {
    costPerUnit: g.costPerMile,
    greatMinNetPerUnit: g.greatMinNetPerMile,
    greatMinNetPerHour: g.greatMinNetPerHour,
    badBelowNetPerUnit: g.badBelowNetPerMile,
    badBelowNetPerHour: g.badBelowNetPerHour,
  };
  const same = (Object.keys(p) as Array<keyof MarketProfile>).every((k) => p[k] === US_PROFILE[k]);
  return same ? null : p;
}

/** Clamps a market profile to sane ranges in that market's currency and keeps tiers coherent. */
export function normalizeProfile(input: unknown, code: MarketCode): MarketProfile {
  const p = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const def = profileFor({ home: code, autoDetect: true, profiles: {} }, code);
  const fx = Math.max(1, CURRENCIES[getMarket(code).currency].perUsd);
  const out: MarketProfile = {
    costPerUnit: num(p.costPerUnit, def.costPerUnit, 0, 3 * fx),
    greatMinNetPerUnit: num(p.greatMinNetPerUnit, def.greatMinNetPerUnit, 0, 20 * fx),
    greatMinNetPerHour: num(p.greatMinNetPerHour, def.greatMinNetPerHour, 0, 500 * fx),
    badBelowNetPerUnit: num(p.badBelowNetPerUnit, def.badBelowNetPerUnit, 0, 20 * fx),
    badBelowNetPerHour: num(p.badBelowNetPerHour, def.badBelowNetPerHour, 0, 500 * fx),
  };
  out.badBelowNetPerUnit = Math.min(out.badBelowNetPerUnit, out.greatMinNetPerUnit);
  out.badBelowNetPerHour = Math.min(out.badBelowNetPerHour, out.greatMinNetPerHour);
  return out;
}

export function normalizeMarket(input: unknown, legacyUs: MarketProfile | null): MarketSettings {
  const m = (input && typeof input === 'object' ? input : {}) as Record<string, any>;
  const profiles: MarketSettings['profiles'] = {};
  const rawProfiles = m.profiles && typeof m.profiles === 'object' ? (m.profiles as Record<string, unknown>) : {};
  for (const [code, p] of Object.entries(rawProfiles)) {
    if (isMarketCode(code)) profiles[code] = normalizeProfile(p, code);
  }
  if (legacyUs && !profiles.US) profiles.US = normalizeProfile(legacyUs, 'US');
  return {
    home: isMarketCode(m.home) ? m.home : 'US',
    autoDetect: typeof m.autoDetect === 'boolean' ? m.autoDetect : true,
    profiles,
  };
}

/**
 * Grading settings for one market: that market's profile converted to per-MILE values
 * (the engine's canonical unit), plus the shared non-money settings.
 */
export function gradingFor(s: Pick<AppSettings, 'grading' | 'market'>, code: MarketCode): GradingSettings {
  const p = profileFor(s.market, code);
  const unit = getMarket(code).unit;
  return {
    ...s.grading,
    costPerMile: ratePerMile(p.costPerUnit, unit),
    greatMinNetPerMile: ratePerMile(p.greatMinNetPerUnit, unit),
    greatMinNetPerHour: p.greatMinNetPerHour,
    badBelowNetPerMile: ratePerMile(p.badBelowNetPerUnit, unit),
    badBelowNetPerHour: p.badBelowNetPerHour,
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
