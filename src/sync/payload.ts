import type { OfferRecord, WaitRow } from '../engine/records';

export const MAX_BATCH = 200;
export const PAYLOAD_SCHEMA = 'rideoffer.ingest.v1';

export interface IngestPayload {
  schema: typeof PAYLOAD_SCHEMA;
  driverId: string;
  sentAt: string;
  appVersion: string;
  offers: Array<Omit<OfferRecord, 'synced'> & { tsIso: string }>;
  waits: Array<Omit<WaitRow, 'synced'> & { startIso: string }>;
}

export interface Batch {
  payload: IngestPayload;
  offerIds: number[];
  waitIds: number[];
}

/**
 * Oldest-first batch of at most MAX_BATCH records (offers + waits combined), so a long
 * offline backlog drains in order and neither record type can starve the other.
 */
export function buildBatch(
  offers: OfferRecord[],
  waits: WaitRow[],
  meta: { driverId: string; appVersion: string; now: number },
  max = MAX_BATCH
): Batch | null {
  type Item = { ts: number; kind: 'offer'; o: OfferRecord } | { ts: number; kind: 'wait'; w: WaitRow };
  const items: Item[] = [
    ...offers.filter((o) => !o.synced).map((o) => ({ ts: o.ts, kind: 'offer' as const, o })),
    ...waits.filter((w) => !w.synced).map((w) => ({ ts: w.startTs, kind: 'wait' as const, w })),
  ]
    .sort((a, b) => a.ts - b.ts)
    .slice(0, Math.max(1, max));
  if (items.length === 0) return null;

  const outOffers: IngestPayload['offers'] = [];
  const outWaits: IngestPayload['waits'] = [];
  for (const it of items) {
    if (it.kind === 'offer') {
      const { synced: _s, ...rest } = it.o;
      outOffers.push({ ...rest, tsIso: new Date(rest.ts).toISOString() });
    } else {
      const { synced: _s, ...rest } = it.w;
      outWaits.push({ ...rest, startIso: new Date(rest.startTs).toISOString() });
    }
  }
  return {
    payload: {
      schema: PAYLOAD_SCHEMA,
      driverId: meta.driverId,
      sentAt: new Date(meta.now).toISOString(),
      appVersion: meta.appVersion,
      offers: outOffers,
      waits: outWaits,
    },
    offerIds: outOffers.map((o) => o.id),
    waitIds: outWaits.map((w) => w.id),
  };
}

export type SyncOutcome =
  | { kind: 'synced'; count: number }
  | { kind: 'key_rejected' }
  | { kind: 'failed'; message: string }
  | { kind: 'nothing' }
  | { kind: 'disabled' };

export function classifyStatus(status: number): 'synced' | 'key_rejected' | 'failed' {
  if (status === 200) return 'synced';
  if (status === 401) return 'key_rejected';
  return 'failed';
}
