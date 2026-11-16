import type { OfferRecord, WaitRow } from '../engine/records';

const OFFER_COLUMNS: Array<keyof OfferRecord> = [
  'id', 'ts', 'platform', 'offerType', 'fare', 'surge', 'surgeIncluded', 'total',
  'pickupMi', 'pickupMin', 'tripMi', 'tripMin', 'pickupArea', 'dropoffArea', 'riderRating',
  'multiStop', 'zoneClass', 'zoneKeyword', 'effMi', 'effMin', 'cost', 'net',
  'grossPerMile', 'grossPerHour', 'netPerMile', 'netPerHour', 'verdict', 'reason', 'flags',
  'confidence', 'readPath', 'fallbackFields', 'rawText', 'sessionId', 'synced',
  // v11 (appended so column positions from earlier exports stay the same)
  'totalMi', 'totalMin', 'currency', 'distanceUnit', 'market',
];

const WAIT_COLUMNS: Array<keyof WaitRow> = ['id', 'startTs', 'durationSec', 'zoneText', 'startedBy', 'endedBy', 'sessionId', 'synced'];

export function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = Array.isArray(v) ? v.join('; ') : typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
  // Neutralize spreadsheet formula injection from OCR text.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function offersToCsv(offers: OfferRecord[]): string {
  const header = ['iso_time', ...OFFER_COLUMNS].join(',');
  const rows = offers.map((o) =>
    [new Date(o.ts).toISOString(), ...OFFER_COLUMNS.map((c) => o[c])].map(csvCell).join(',')
  );
  return [header, ...rows].join('\r\n') + '\r\n';
}

export function waitsToCsv(waits: WaitRow[]): string {
  const header = ['iso_start', ...WAIT_COLUMNS].join(',');
  const rows = waits.map((w) => [new Date(w.startTs).toISOString(), ...WAIT_COLUMNS.map((c) => w[c])].map(csvCell).join(','));
  return [header, ...rows].join('\r\n') + '\r\n';
}

export function toJsonExport(offers: OfferRecord[], waits: WaitRow[], meta: { driverId: string; exportedAt: number }): string {
  return JSON.stringify(
    {
      schema: 'rideoffer.export.v1',
      exportedAt: new Date(meta.exportedAt).toISOString(),
      driverId: meta.driverId,
      offers,
      waits,
    },
    null,
    2
  );
}
