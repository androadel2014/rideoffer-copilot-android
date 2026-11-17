import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { deleteOffer, getOffer } from '../../db/database';
import { formatPerDistance, getMarket, recordFormat } from '../../engine/market';
import type { OfferRecord } from '../../engine/records';
import { bumpHistory } from '../../state/appStore';
import {
  Button,
  Card,
  Chip,
  DistanceBar,
  EmptyState,
  KeyValue,
  MetricTile,
  RateHeadline,
  Screen,
  SectionLabel,
  Stars,
  TopBar,
} from '../components';
import { fmtDay, fmtMi, fmtMin, fmtMoney, fmtPerHour, fmtPerMile, fmtRating, fmtTime, platformLabel } from '../format';
import { useNav } from '../navigation';
import { colors, radius, space, type, zoneColor } from '../theme';

const FIELD_LABELS: Record<string, string> = {
  fare: 'Fare',
  surge: 'Bonus',
  pickupMi: 'Pickup distance',
  pickupMin: 'Pickup time',
  tripMi: 'Trip distance',
  tripMin: 'Trip time',
  totalMi: 'Total distance',
  totalMin: 'Total time',
  pickupArea: 'Pickup area',
  dropoffArea: 'Dropoff area',
  riderRating: 'Rider rating',
  offerType: 'Ride type',
};

const legSum = (a: number | null | undefined, b: number | null | undefined) => (b == null ? null : (a ?? 0) + b);

export function OfferDetailScreen({ id }: { id: number }) {
  const nav = useNav();
  const [o, setO] = useState<OfferRecord | null | undefined>(undefined);

  useEffect(() => {
    getOffer(id).then(setO, () => setO(null));
  }, [id]);

  if (o === undefined)
    return (
      <Screen>
        <TopBar title="Offer" onBack={nav.pop} />
      </Screen>
    );
  if (o === null) {
    return (
      <Screen>
        <TopBar title="Offer" onBack={nav.pop} />
        <EmptyState title="Offer not found" body="It may have been deleted." />
      </Screen>
    );
  }

  const f = recordFormat(o);
  const unitWord = f.unit === 'km' ? 'km' : 'mile';
  // Old records (before v11) have no stored total: pickup + trip.
  const totalMi = o.totalMi ?? legSum(o.pickupMi, o.tripMi);
  const totalMin = o.totalMin ?? legSum(o.pickupMin, o.tripMin);
  const returnMi = o.zoneClass === 'dead' && o.effMi != null && totalMi != null ? Math.max(0, o.effMi - totalMi) : null;
  const returnMin = o.zoneClass === 'dead' && o.effMin != null && totalMin != null ? Math.max(0, o.effMin - totalMin) : null;
  // The cost per mile that was actually used when this offer was graded.
  const costPerMile = o.cost != null && o.effMi ? o.cost / o.effMi : null;
  const hasBonus = o.surge != null && o.surge > 0;

  const confirmDelete = () =>
    Alert.alert('Delete this offer?', 'It will be removed from History and exports. This cannot be undone.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteOffer(o.id);
          bumpHistory();
          nav.pop();
        },
      },
    ]);

  return (
    <Screen>
      <TopBar
        title="Offer details"
        subtitle={`${fmtDay(o.ts)} · ${fmtTime(o.ts)} · ${platformLabel(o.platform)}${o.offerType ? ` · ${o.offerType}` : ''}`}
        onBack={nav.pop}
      />

      {/* Verdict */}
      <Card tone={o.verdict ?? 'CHECK'}>
        <RateHeadline verdict={o.verdict} netPerHour={o.netPerHour} netPerMile={o.netPerMile} reason={o.reason} fmt={f} />
        {o.flags.length ? (
          <View style={styles.chips}>
            {o.flags.map((flag) => (
              <Chip key={flag} label={flag} />
            ))}
          </View>
        ) : null}
      </Card>

      {/* At a glance */}
      <View style={styles.tiles}>
        <MetricTile label="Pay" value={fmtMoney(o.total ?? o.fare, f)} sub={hasBonus ? `incl. ${fmtMoney(o.surge, f)} bonus` : 'Fare shown'} emphasis />
        <MetricTile label="Distance" value={fmtMi(totalMi, f)} sub="Incl. pickup" emphasis />
        <MetricTile label="Time" value={fmtMin(totalMin)} sub="Incl. pickup" emphasis />
      </View>

      <SectionLabel>Pay</SectionLabel>
      <Card style={styles.group}>
        <KeyValue k="Fare shown" v={fmtMoney(o.fare, f)} mono />
        {hasBonus ? (
          <KeyValue
            k="Bonus / surge"
            sub={o.surgeIncluded ? 'Already included in the fare' : 'Shown separately on the card'}
            v={`${o.surgeIncluded ? '' : '+'}${fmtMoney(o.surge, f)}`}
            mono
            tone={colors.great}
          />
        ) : null}
        <KeyValue k="Total pay used for grading" v={fmtMoney(o.total, f)} mono strong last />
      </Card>

      <SectionLabel>Distance and time</SectionLabel>
      <Card style={styles.group}>
        <View style={{ paddingTop: space(4), paddingBottom: space(2) }}>
          <DistanceBar pickup={o.pickupMi} trip={o.tripMi} extra={returnMi} />
        </View>
        <LegRow label="Pickup" sub="Driving to the rider (unpaid)" dist={fmtMi(o.pickupMi, f)} time={fmtMin(o.pickupMin)} color={colors.accent} />
        <LegRow label="Trip" sub="Rider on board" dist={fmtMi(o.tripMi, f)} time={fmtMin(o.tripMin)} color={colors.great} />
        <LegRow label="Total" sub="Every rate uses this" dist={fmtMi(totalMi, f)} time={fmtMin(totalMin)} strong last={returnMi == null} />
        {returnMi != null ? (
          <>
            <LegRow label="Dead-zone return" sub="Drive back, added by your zone settings" dist={`+${fmtMi(returnMi, f)}`} time={`+${fmtMin(returnMin)}`} color={colors.dead} />
            <LegRow label="Graded on" sub="Total + return" dist={fmtMi(o.effMi, f)} time={fmtMin(o.effMin)} strong last />
          </>
        ) : null}
      </Card>

      <SectionLabel>Rider</SectionLabel>
      <Card style={styles.group}>
        <View style={[styles.riderRow]}>
          <Text style={[type.small, { flex: 1 }]}>Star rating</Text>
          <Stars rating={o.riderRating} label={o.riderRating != null ? fmtRating(o.riderRating, f) : undefined} />
        </View>
        <Text style={[type.tiny, { paddingBottom: space(4) }]}>Rider names are never read into History, exports or sync.</Text>
      </Card>

      <SectionLabel>How the rates were worked out</SectionLabel>
      <Card style={styles.group}>
        <KeyValue k="Total pay" v={fmtMoney(o.total, f)} mono />
        <KeyValue
          k="Vehicle cost"
          sub={costPerMile != null && o.effMi != null ? `${fmtMi(o.effMi, f)} × ${formatPerDistance(costPerMile, f)}` : undefined}
          v={o.cost != null ? `−${fmtMoney(o.cost, f)}` : '—'}
          mono
        />
        <KeyValue k="Net" v={fmtMoney(o.net, f)} mono strong />
        <KeyValue k="Net per hour" v={fmtPerHour(o.netPerHour, f)} mono />
        <KeyValue k={`Net per ${unitWord}`} v={fmtPerMile(o.netPerMile, f)} mono />
        <KeyValue k="Gross per hour" v={fmtPerHour(o.grossPerHour, f)} mono />
        <KeyValue k={`Gross per ${unitWord}`} v={fmtPerMile(o.grossPerMile, f)} mono last />
      </Card>

      <SectionLabel>Ride</SectionLabel>
      <Card style={styles.group}>
        <KeyValue k="App" v={platformLabel(o.platform)} />
        <KeyValue k="Ride type" v={o.offerType ?? 'Not shown'} />
        <KeyValue k="Multiple stops" v={o.multiStop ? 'Yes' : 'No'} />
        <KeyValue k="Market" sub={`${f.currency} · ${f.unit === 'km' ? 'kilometres' : 'miles'}`} v={o.market ? getMarket(o.market).name : 'United States'} last />
      </Card>

      <SectionLabel>Places (as shown on the card)</SectionLabel>
      <Card style={styles.group}>
        <KeyValue k="Pickup area" v={o.pickupArea ?? 'Not read'} />
        <KeyValue k="Dropoff area" v={o.dropoffArea ?? 'Not read'} />
        <View style={styles.zoneRow}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: zoneColor(o.zoneClass) }} />
          <Text style={type.bodyStrong}>
            {o.zoneClass === 'hot' ? 'Hot zone' : o.zoneClass === 'dead' ? 'Dead zone' : 'Neutral zone'}
            {o.zoneKeyword ? ` (matched "${o.zoneKeyword}")` : ''}
          </Text>
        </View>
      </Card>

      <SectionLabel>Read quality</SectionLabel>
      <Card style={styles.group}>
        <KeyValue k="Confidence" v={`${Math.round(o.confidence * 100)}%`} />
        <KeyValue
          k="How it was read"
          v={o.readPath === 'primary' ? 'Card regions' : 'Whole-card scan'}
          last={!o.fallbackFields.length}
        />
        {o.fallbackFields.length ? (
          <KeyValue k="Read by whole-card scan" v={o.fallbackFields.map((x) => FIELD_LABELS[x] ?? x).join(', ')} last />
        ) : null}
        <Text style={[type.label, { marginTop: space(3), marginBottom: space(2) }]}>Text read from the card</Text>
        <View style={styles.raw}>
          <Text selectable style={type.mono}>
            {o.rawText || '(empty)'}
          </Text>
        </View>
        <Text style={[type.tiny, { marginTop: space(2), marginBottom: space(4) }]}>Rider names are removed before saving and appear as [rider].</Text>
      </Card>

      <Button label="Delete this offer" variant="danger" onPress={confirmDelete} style={{ marginTop: space(8) }} />
    </Screen>
  );
}

function LegRow({
  label,
  sub,
  dist,
  time,
  color,
  strong,
  last,
}: {
  label: string;
  sub: string;
  dist: string;
  time: string;
  color?: string;
  strong?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.leg, !last && styles.legBorder]}>
      <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: color ?? 'transparent' }} />
      <View style={{ flex: 1 }}>
        <Text style={[type.bodyStrong, strong && { fontSize: 17 }]}>{label}</Text>
        <Text style={[type.tiny, { marginTop: 2 }]}>{sub}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[type.bodyStrong, { fontVariant: ['tabular-nums'] }, strong && { fontSize: 18, fontWeight: '800' }]}>{dist}</Text>
        <Text style={[type.small, { fontVariant: ['tabular-nums'] }]}>{time}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2), marginTop: space(4) },
  tiles: { flexDirection: 'row', gap: space(2), marginTop: space(3) },
  group: { paddingVertical: 0 },
  leg: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(3), minHeight: 56 },
  legBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderHi },
  riderRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space(4) },
  zoneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: space(4) },
  raw: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.sm,
    padding: space(3),
    borderWidth: 1,
    borderColor: colors.border,
  },
});
