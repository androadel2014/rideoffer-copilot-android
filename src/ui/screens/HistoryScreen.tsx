import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { latestSession, listOffers, listWaits } from '../../db/database';
import { computeTotals, type OfferRecord, type WaitRow } from '../../engine/records';
import { exportHistory, type ExportKind } from '../../export/exporter';
import { useStore } from '../../state/createStore';
import { appStore } from '../../state/appStore';
import { Button, Card, EmptyState, Notice, SectionLabel, Segmented, Stat, VerdictBadge } from '../components';
import { fmtDay, fmtDuration, fmtMoney, fmtPerHour, fmtPerMile, fmtTime, platformLabel, startOfToday } from '../format';
import { useNav } from '../navigation';
import { colors, radius, space, type, verdictColor, zoneColor } from '../theme';

type Range = 'today' | 'session' | 'all';
type View_ = 'offers' | 'waits';

const MAX_ROWS = 300;

export function HistoryScreen() {
  const nav = useNav();
  const version = useStore(appStore, (s) => s.historyVersion);
  const liveSession = useStore(appStore, (s) => s.sessionId);
  const [range, setRange] = useState<Range>('today');
  const [view, setView] = useState<View_>('offers');
  const [offers, setOffers] = useState<OfferRecord[]>([]);
  const [waits, setWaits] = useState<WaitRow[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [exporting, setExporting] = useState<ExportKind | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let q: { sinceTs?: number; sessionId?: number } = {};
        let sid: number | null = null;
        if (range === 'today') q = { sinceTs: startOfToday() };
        if (range === 'session') {
          sid = liveSession ?? (await latestSession())?.id ?? null;
          q = { sessionId: sid ?? -1 };
        }
        const [o, w] = await Promise.all([listOffers(q), listWaits(q)]);
        if (!alive) return;
        setOffers(o);
        setWaits(w);
        setSessionId(sid);
      } catch {
        if (alive) {
          setOffers([]);
          setWaits([]);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [range, version, liveSession]);

  const totals = useMemo(() => computeTotals(offers, waits), [offers, waits]);
  const rangeQuery = range === 'today' ? { sinceTs: startOfToday() } : range === 'session' ? { sessionId: sessionId ?? -1 } : {};

  const doExport = async (kind: ExportKind) => {
    setExporting(kind);
    setExportMsg(null);
    const r = await exportHistory(kind, rangeQuery);
    setExporting(null);
    setExportMsg({ ok: r.ok, text: r.message });
  };

  const empty = !loading && offers.length === 0 && waits.length === 0;

  return (
    <View>
      <Text style={[type.h1, { marginBottom: space(4) }]}>History</Text>
      <Segmented
        options={[
          { value: 'today', label: 'Today' },
          { value: 'session', label: 'Last session' },
          { value: 'all', label: 'All time' },
        ]}
        value={range}
        onChange={setRange}
      />

      {empty ? (
        <EmptyState
          title={range === 'session' ? 'No session yet' : range === 'today' ? 'No offers today' : 'No history yet'}
          body="Every offer you receive while watching is saved here automatically with its verdict, rates and the text that was read. Wait times between offers are logged too."
        />
      ) : (
        <>
          <Card style={{ marginTop: space(4) }}>
            <View style={{ flexDirection: 'row', gap: space(3) }}>
              <Stat label="Offers" value={String(totals.offers)} />
              <Stat label="Great" value={String(totals.great)} tone={colors.great} />
              <Stat label="OK" value={String(totals.ok)} tone={colors.ok} />
              <Stat label="Bad" value={String(totals.bad)} tone={colors.bad} />
            </View>
            <View style={styles.hr} />
            <View style={{ flexDirection: 'row', gap: space(3) }}>
              <Stat label="Avg net/hr" value={fmtPerHour(totals.avgNetPerHour)} />
              <Stat label="Avg net/mi" value={fmtPerMile(totals.avgNetPerMile)} />
            </View>
            <View style={styles.hr} />
            <View style={{ flexDirection: 'row', gap: space(3) }}>
              <Stat label="Offered $" value={fmtMoney(totals.sumFares)} hint="Sum of all offers seen" />
              <Stat label="Waiting" value={fmtDuration(totals.waitSec)} hint={totals.avgWaitSec != null ? `Avg ${fmtDuration(totals.avgWaitSec)}` : undefined} />
            </View>
          </Card>

          <View style={{ marginTop: space(5) }}>
            <Segmented
              options={[
                { value: 'offers', label: `Offers (${offers.length})` },
                { value: 'waits', label: `Waits (${waits.length})` },
              ]}
              value={view}
              onChange={setView}
            />
          </View>

          {view === 'offers' ? (
            offers.length === 0 ? (
              <Text style={[type.small, { marginTop: space(4) }]}>No offers in this range.</Text>
            ) : (
              <View style={{ marginTop: space(3), gap: space(3) }}>
                {offers.slice(0, MAX_ROWS).map((o, i) => (
                  <React.Fragment key={o.id}>
                    {i === 0 || fmtDay(offers[i - 1].ts) !== fmtDay(o.ts) ? (
                      <Text style={[type.label, { marginTop: i === 0 ? 0 : space(3) }]}>{fmtDay(o.ts)}</Text>
                    ) : null}
                    <OfferRow o={o} onPress={() => nav.push({ name: 'offer', id: o.id })} />
                  </React.Fragment>
                ))}
                {offers.length > MAX_ROWS ? (
                  <Text style={type.tiny}>Showing the latest {MAX_ROWS}. Export to see everything.</Text>
                ) : null}
              </View>
            )
          ) : waits.length === 0 ? (
            <Text style={[type.small, { marginTop: space(4) }]}>No wait records in this range.</Text>
          ) : (
            <Card style={{ marginTop: space(3), paddingVertical: space(2) }}>
              {waits.slice(0, MAX_ROWS).map((w, i) => (
                <View key={w.id} style={[styles.waitRow, i > 0 && styles.waitBorder]}>
                  <View style={{ flex: 1 }}>
                    <Text style={type.bodyStrong}>{fmtDuration(w.durationSec)}</Text>
                    <Text style={type.small}>
                      {fmtDay(w.startTs)} {fmtTime(w.startTs)} · {w.zoneText ?? 'Location not known (went online)'}
                    </Text>
                  </View>
                  <Text style={[type.tiny, { textAlign: 'right' }]}>{endedByLabel(w.endedBy)}</Text>
                </View>
              ))}
            </Card>
          )}
        </>
      )}

      <SectionLabel>Export</SectionLabel>
      <Card style={{ gap: space(3) }}>
        <Text style={type.small}>
          Exports the range selected above ({range === 'today' ? 'today' : range === 'session' ? 'last session' : 'all time'}). You
          choose where the file goes. Rider names are never included.
        </Text>
        <Button label="Export offers (CSV)" variant="secondary" loading={exporting === 'offers_csv'} onPress={() => void doExport('offers_csv')} />
        <Button label="Export waits (CSV)" variant="secondary" loading={exporting === 'waits_csv'} onPress={() => void doExport('waits_csv')} />
        <Button label="Export everything (JSON)" variant="secondary" loading={exporting === 'all_json'} onPress={() => void doExport('all_json')} />
        {exportMsg ? <Notice tone={exportMsg.ok ? 'good' : 'warn'} title={exportMsg.text} /> : null}
      </Card>
    </View>
  );
}

function endedByLabel(e: WaitRow['endedBy']) {
  return e === 'offer' ? 'Ended by offer' : e === 'trip_started' ? 'Trip started' : 'Stopped watching';
}

function OfferRow({ o, onPress }: { o: OfferRecord; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${o.verdict ?? 'Check'} offer, ${fmtMoney(o.total ?? o.fare)}. Open details`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfacePressed }]}
    >
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
          <VerdictBadge verdict={o.verdict} size="sm" />
          <Text style={type.tiny}>
            {fmtTime(o.ts)} · {platformLabel(o.platform)}
            {o.offerType ? ` · ${o.offerType}` : ''}
          </Text>
        </View>
        <Text style={[type.h3, { fontSize: 19 }]}>{fmtMoney(o.total ?? o.fare)}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: zoneColor(o.zoneClass) }} />
          <Text style={[type.small, { flex: 1 }]} numberOfLines={1}>
            {o.dropoffArea ?? 'Dropoff not read'}
          </Text>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', justifyContent: 'center', gap: 2 }}>
        <Text style={[type.h3, { fontSize: 22, fontVariant: ['tabular-nums'], color: verdictColor(o.verdict).fg }]}>{fmtPerHour(o.netPerHour)}</Text>
        <Text style={[type.bodyStrong, { fontSize: 18, fontVariant: ['tabular-nums'], color: verdictColor(o.verdict).fg }]}>{fmtPerMile(o.netPerMile)}</Text>
        <Text style={[type.tiny, { color: colors.accent, marginTop: 4 }]}>Details</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hr: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: space(4) },
  row: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(4),
    gap: space(3),
    minHeight: 96,
  },
  waitRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space(3), gap: space(3) },
  waitBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
