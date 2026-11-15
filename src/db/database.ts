import * as SQLite from 'expo-sqlite';
import { DEFAULT_ZONES } from '../config/defaults';
import type { OfferRecord, SessionRow, WaitRow } from '../engine/records';
import type { Zone, ZoneClass } from '../engine/types';

/**
 * Local SQLite store. Everything the app knows lives here, on the phone.
 * Schema changes go through numbered migrations keyed on PRAGMA user_version.
 */

const DB_NAME = 'rideoffer.db';
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    ts INTEGER NOT NULL,
    platform TEXT NOT NULL,
    fare REAL, surge REAL, surge_included INTEGER NOT NULL DEFAULT 0, total REAL,
    pickup_mi REAL, pickup_min REAL, trip_mi REAL, trip_min REAL,
    pickup_area TEXT, dropoff_area TEXT, rider_rating REAL, offer_type TEXT,
    multi_stop INTEGER NOT NULL DEFAULT 0,
    zone_class TEXT NOT NULL DEFAULT 'neutral', zone_keyword TEXT,
    eff_mi REAL, eff_min REAL, cost REAL, net REAL,
    gross_per_mile REAL, gross_per_hour REAL, net_per_mile REAL, net_per_hour REAL,
    verdict TEXT, reason TEXT NOT NULL DEFAULT '', flags TEXT NOT NULL DEFAULT '[]',
    confidence REAL NOT NULL DEFAULT 0, read_path TEXT NOT NULL DEFAULT 'primary',
    fallback_fields TEXT NOT NULL DEFAULT '[]', raw_text TEXT NOT NULL DEFAULT '',
    synced INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_offers_ts ON offers(ts);
  CREATE INDEX IF NOT EXISTS idx_offers_synced ON offers(synced);
  CREATE TABLE IF NOT EXISTS waits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    zone_text TEXT,
    start_ts INTEGER NOT NULL,
    duration_sec INTEGER NOT NULL,
    ended_by TEXT NOT NULL,
    started_by TEXT NOT NULL DEFAULT 'online',
    synced INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_waits_start ON waits(start_ts);
  CREATE TABLE IF NOT EXISTS zones (
    id TEXT PRIMARY KEY NOT NULL,
    keyword TEXT NOT NULL,
    zone_class TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0
  );
  `,
];

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      await migrate(db);
      return db;
    })().catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

async function migrate(db: SQLite.SQLiteDatabase) {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version];
    await db.withTransactionAsync(async () => {
      await db.execAsync(sql);
      if (version === 0) await seedZones(db, DEFAULT_ZONES);
    });
    version++;
    await db.execAsync(`PRAGMA user_version = ${version}`);
  }
}

// ---------------------------------------------------------------------------------------
// KV
// ---------------------------------------------------------------------------------------

export async function getKv(key: string): Promise<string | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]);
  return r?.value ?? null;
}

export async function setKv(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    value,
  ]);
}

// ---------------------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------------------

export async function startSession(ts: number): Promise<number> {
  const db = await getDb();
  // Close any session left open by a crash or force-stop.
  await db.runAsync('UPDATE sessions SET ended_at = ? WHERE ended_at IS NULL', [ts]);
  const r = await db.runAsync('INSERT INTO sessions (started_at) VALUES (?)', [ts]);
  return Number(r.lastInsertRowId);
}

export async function endSession(id: number, ts: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL', [ts, id]);
}

export async function latestSession(): Promise<SessionRow | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ id: number; started_at: number; ended_at: number | null }>(
    'SELECT * FROM sessions ORDER BY id DESC LIMIT 1'
  );
  return r ? { id: r.id, startedAt: r.started_at, endedAt: r.ended_at } : null;
}

// ---------------------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------------------

type OfferDbRow = Record<string, any>;

const parseJsonArray = (s: unknown): string[] => {
  try {
    const v = JSON.parse(String(s ?? '[]'));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

function mapOffer(r: OfferDbRow): OfferRecord {
  return {
    id: r.id,
    sessionId: r.session_id ?? null,
    ts: r.ts,
    platform: r.platform,
    fare: r.fare,
    surge: r.surge,
    surgeIncluded: !!r.surge_included,
    total: r.total,
    pickupMi: r.pickup_mi,
    pickupMin: r.pickup_min,
    tripMi: r.trip_mi,
    tripMin: r.trip_min,
    pickupArea: r.pickup_area,
    dropoffArea: r.dropoff_area,
    riderRating: r.rider_rating,
    offerType: r.offer_type,
    multiStop: !!r.multi_stop,
    zoneClass: (r.zone_class ?? 'neutral') as ZoneClass,
    zoneKeyword: r.zone_keyword,
    effMi: r.eff_mi,
    effMin: r.eff_min,
    cost: r.cost,
    net: r.net,
    grossPerMile: r.gross_per_mile,
    grossPerHour: r.gross_per_hour,
    netPerMile: r.net_per_mile,
    netPerHour: r.net_per_hour,
    verdict: r.verdict ?? null,
    reason: r.reason ?? '',
    flags: parseJsonArray(r.flags),
    confidence: r.confidence ?? 0,
    readPath: r.read_path === 'fallback' ? 'fallback' : 'primary',
    fallbackFields: parseJsonArray(r.fallback_fields),
    rawText: r.raw_text ?? '',
    synced: !!r.synced,
  };
}

export async function insertOffer(o: Omit<OfferRecord, 'id' | 'synced'>): Promise<number> {
  const db = await getDb();
  const r = await db.runAsync(
    `INSERT INTO offers (
      session_id, ts, platform, fare, surge, surge_included, total,
      pickup_mi, pickup_min, trip_mi, trip_min, pickup_area, dropoff_area, rider_rating, offer_type,
      multi_stop, zone_class, zone_keyword, eff_mi, eff_min, cost, net,
      gross_per_mile, gross_per_hour, net_per_mile, net_per_hour,
      verdict, reason, flags, confidence, read_path, fallback_fields, raw_text, synced
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
    [
      o.sessionId, o.ts, o.platform, o.fare, o.surge, o.surgeIncluded ? 1 : 0, o.total,
      o.pickupMi, o.pickupMin, o.tripMi, o.tripMin, o.pickupArea, o.dropoffArea, o.riderRating, o.offerType,
      o.multiStop ? 1 : 0, o.zoneClass, o.zoneKeyword, o.effMi, o.effMin, o.cost, o.net,
      o.grossPerMile, o.grossPerHour, o.netPerMile, o.netPerHour,
      o.verdict, o.reason, JSON.stringify(o.flags), o.confidence, o.readPath, JSON.stringify(o.fallbackFields), o.rawText,
    ]
  );
  return Number(r.lastInsertRowId);
}

export interface OfferQuery {
  sinceTs?: number;
  sessionId?: number;
  limit?: number;
}

export async function listOffers(q: OfferQuery = {}): Promise<OfferRecord[]> {
  const db = await getDb();
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (q.sinceTs != null) {
    where.push('ts >= ?');
    args.push(q.sinceTs);
  }
  if (q.sessionId != null) {
    where.push('session_id = ?');
    args.push(q.sessionId);
  }
  const sql = `SELECT * FROM offers ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts DESC LIMIT ?`;
  args.push(q.limit ?? 5000);
  const rows = await db.getAllAsync<OfferDbRow>(sql, args);
  return rows.map(mapOffer);
}

export async function getOffer(id: number): Promise<OfferRecord | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<OfferDbRow>('SELECT * FROM offers WHERE id = ?', [id]);
  return r ? mapOffer(r) : null;
}

export async function deleteOffer(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM offers WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------------------
// Waits
// ---------------------------------------------------------------------------------------

function mapWait(r: Record<string, any>): WaitRow {
  return {
    id: r.id,
    sessionId: r.session_id ?? null,
    zoneText: r.zone_text ?? null,
    startTs: r.start_ts,
    durationSec: r.duration_sec,
    endedBy: r.ended_by,
    startedBy: r.started_by ?? 'online',
    synced: !!r.synced,
  };
}

export async function insertWait(w: Omit<WaitRow, 'id' | 'synced'>): Promise<number> {
  const db = await getDb();
  const r = await db.runAsync(
    'INSERT INTO waits (session_id, zone_text, start_ts, duration_sec, ended_by, started_by) VALUES (?,?,?,?,?,?)',
    [w.sessionId, w.zoneText, w.startTs, w.durationSec, w.endedBy, w.startedBy]
  );
  return Number(r.lastInsertRowId);
}

export async function listWaits(q: OfferQuery = {}): Promise<WaitRow[]> {
  const db = await getDb();
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (q.sinceTs != null) {
    where.push('start_ts >= ?');
    args.push(q.sinceTs);
  }
  if (q.sessionId != null) {
    where.push('session_id = ?');
    args.push(q.sessionId);
  }
  const sql = `SELECT * FROM waits ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY start_ts DESC LIMIT ?`;
  args.push(q.limit ?? 5000);
  return (await db.getAllAsync<Record<string, any>>(sql, args)).map(mapWait);
}

// ---------------------------------------------------------------------------------------
// Sync bookkeeping
// ---------------------------------------------------------------------------------------

export async function listUnsynced(limit: number): Promise<{ offers: OfferRecord[]; waits: WaitRow[] }> {
  const db = await getDb();
  const offers = (await db.getAllAsync<OfferDbRow>('SELECT * FROM offers WHERE synced = 0 ORDER BY ts ASC LIMIT ?', [limit])).map(
    mapOffer
  );
  const waits = (
    await db.getAllAsync<Record<string, any>>('SELECT * FROM waits WHERE synced = 0 ORDER BY start_ts ASC LIMIT ?', [limit])
  ).map(mapWait);
  return { offers, waits };
}

export async function countUnsynced(): Promise<number> {
  const db = await getDb();
  const a = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM offers WHERE synced = 0');
  const b = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM waits WHERE synced = 0');
  return (a?.n ?? 0) + (b?.n ?? 0);
}

export async function markSynced(offerIds: number[], waitIds: number[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const chunk of chunks(offerIds, 400)) {
      await db.runAsync(`UPDATE offers SET synced = 1 WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk);
    }
    for (const chunk of chunks(waitIds, 400)) {
      await db.runAsync(`UPDATE waits SET synced = 1 WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk);
    }
  });
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

// ---------------------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------------------

async function seedZones(db: SQLite.SQLiteDatabase, zones: Zone[]) {
  let i = 0;
  for (const z of zones) {
    await db.runAsync('INSERT OR REPLACE INTO zones (id, keyword, zone_class, sort) VALUES (?,?,?,?)', [
      z.id,
      z.keyword,
      z.zoneClass,
      i++,
    ]);
  }
}

export async function listZones(): Promise<Zone[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; keyword: string; zone_class: ZoneClass }>(
    'SELECT * FROM zones ORDER BY sort ASC, keyword ASC'
  );
  return rows.map((r) => ({ id: r.id, keyword: r.keyword, zoneClass: r.zone_class }));
}

export async function replaceZones(zones: Zone[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM zones');
    await seedZones(db, zones);
  });
}

// ---------------------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------------------

export async function clearHistory(): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM offers');
    await db.runAsync('DELETE FROM waits');
    await db.runAsync('DELETE FROM sessions WHERE ended_at IS NOT NULL');
  });
}
