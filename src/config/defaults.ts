import { DEFAULT_MARKET_SETTINGS, type MarketSettings } from '../engine/market';
import type { GradingSettings, Zone, ZoneClass } from '../engine/types';

/**
 * DC-metro defaults (driver based in Fairfax, VA).
 *
 * costPerMile 0.30: the *marginal* cost of one more mile in a typical hybrid/efficient
 * sedan (fuel ≈ $0.08–0.10 at 40 mpg and $3.30/gal, tires + maintenance ≈ $0.08,
 * mileage-driven depreciation ≈ $0.10–0.12). The IRS rate (~$0.70) includes fixed
 * costs (insurance, financing) you pay whether or not you take this ride, so it is the
 * wrong number for a take-it-or-leave-it decision. Raise it for an SUV/XL vehicle.
 *
 * Thresholds are on NET, ALL-IN numbers (pickup leg included, dead-zone penalty applied).
 *
 * Since v11 the money fields here (cost and thresholds) are a per-MILE mirror of the
 * home market's profile (AppSettings.market). Distances in this object (dead-zone
 * extra miles, long-trip miles, assumed mph) are always stored in miles and shown in
 * the market's unit by the Settings screen.
 */
export const DEFAULT_GRADING: GradingSettings = {
  costPerMile: 0.3,
  greatMinNetPerMile: 1.25,
  greatMinNetPerHour: 30,
  badBelowNetPerMile: 0.8,
  badBelowNetPerHour: 18,
  deadZoneExtraMinutes: 25,
  deadZoneExtraMiles: 8,
  longTripMinutes: 45,
  longTripMiles: 30,
  longPickupMinutes: 12,
  lowRatingBelow: 4.7,
  addSeparateBonus: true,
  assumedAvgMph: 22,
};

export interface SyncSettings {
  enabled: boolean;
  baseUrl: string;
  driverKey: string;
}

export interface OverlaySettings {
  seconds: number;
  /** "card": float on top of the detected offer card (default). */
  position: 'card' | 'top' | 'center';
}

/** Bumped when stored settings need a one-time migration. v1 = up to app vc10. */
export const SETTINGS_VERSION = 2;

export interface AppSettings {
  settingsVersion: number;
  grading: GradingSettings;
  /** Home market, auto-detect switch and per-market cost/threshold profiles. */
  market: MarketSettings;
  overlay: OverlaySettings;
  driverId: string;
  sync: SyncSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  settingsVersion: SETTINGS_VERSION,
  grading: DEFAULT_GRADING,
  market: DEFAULT_MARKET_SETTINGS,
  overlay: { seconds: 7, position: 'card' },
  driverId: '',
  sync: { enabled: false, baseUrl: '', driverKey: '' },
};

const seed = (zoneClass: ZoneClass, keywords: string[]): Zone[] =>
  keywords.map((keyword) => ({ id: `${zoneClass}:${keyword.toLowerCase()}`, keyword, zoneClass }));

/**
 * Seed zones. Matching is case-insensitive on whole words against the dropoff text
 * exactly as the card shows it; the longest matching keyword wins.
 */
export const DEFAULT_ZONES: Zone[] = [
  ...seed('hot', [
    'Arlington',
    'Rosslyn',
    'Clarendon',
    'Ballston',
    'Crystal City',
    'National Landing',
    'Pentagon City',
    'Tysons',
    'Tysons Corner',
    'Washington, DC',
    'Washington DC',
    'Washington',
    'DC',
    'Georgetown',
    'Dupont',
    'Navy Yard',
    'Capitol Hill',
    'Foggy Bottom',
    'Bethesda',
    'DCA',
    'Reagan National',
    'National Airport',
  ]),
  ...seed('neutral', [
    'Fairfax',
    'Vienna',
    'Merrifield',
    'Falls Church',
    'McLean',
    'Reston',
    'Herndon',
    'Alexandria',
    'Annandale',
    'Springfield',
    'Silver Spring',
    'Rockville',
    'Chantilly',
    'Centreville',
    'Manassas',
    'Dulles',
    // Longer than "Washington" so the airport is not mistaken for the DC core.
    'Washington Dulles',
    'Fort Washington',
    'IAD',
    'Ashburn',
    'Leesburg',
  ]),
  ...seed('dead', [
    'Warrenton',
    'Culpeper',
    'Front Royal',
    'Winchester',
    'Purcellville',
    'Middleburg',
    'Lovettsville',
    'Berryville',
    'Marshall',
    'Bealeton',
    'Haymarket',
    'Stafford',
    'Fredericksburg',
    'Spotsylvania',
    'La Plata',
    'Hagerstown',
  ]),
];
