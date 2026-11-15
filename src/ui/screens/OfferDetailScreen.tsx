import React, { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { deleteOffer, getOffer } from '../../db/database';
import type { OfferRecord } from '../../engine/records';
import { bumpHistory } from '../../state/appStore';
import { settingsStore } from '../../state/settingsStore';
import { Button, Card, EmptyState, KeyValue, RateHeadline, Screen, SectionLabel, TopBar } from '../components';
import { fmtDay, fmtMi, fmtMin, fmtMoney, fmtPerHour, fmtPerMile, fmtTime, platformLabel } from '../format';
import { useNav } from '../navigation';
import { colors, radius, space, type, verdictColor, zoneColor } from '../theme';

const FIELD_LABELS: Record<string, string> = {
  fare: 'Fare',
  surge: 'Bonus',
  pickupMi: 'Pickup miles',
  pickupMin: 'Pickup minutes',
  tripMi: 'Trip miles',
  tripMin: 'Trip minutes',
  pickupArea: 'Pickup area',
  dropoffArea: 'Dropoff area',
  riderRating: 'Rider rating',
  offerType: 'Ride type',
};

export function OfferDetailScreen({ id }: { id: number }) {
  const nav = useNav();
  const [o, setO] = useState<OfferRecord | null | undefined>(undefined);
  const costPerMile = settingsStore.get().settings.grading.costPerMile;

  useEffect(() => {
    getOffer(id).then(setO, () => setO(null));
  }, [id]);

  if (o === undefined) return <Screen><TopBar title="Offer" onBack={nav.pop} /></Screen>;
  if (o === null) {
    return (
      <Screen>
        <TopBar title="Offer" onBack={nav.pop} />
        <EmptyState title="Offer not found" body="It may have been deleted." />
      </Screen>
    );
  }

  const vc = verdictColor(o.verdict);
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
      <TopBar title="Offer details" onBack={nav.pop} />

      <Card style={{ borderColor: vc.fg, backgroundColor: vc.soft }}>
        <Text style={[type.small, { marginBottom: space(3) }]}>
          {fmtDay(o.ts)} · {fmtTime(o.ts)} · {platformLabel(o.platform)} · {fmtMoney(o.total ?? o.fare)}
        </Text>
        <RateHeadline verdict={o.verdict} netPerHour={o.netPerHour} netPerMile={o.netPerMile} reason={o.reason} />
        {o.flags.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2), marginTop: space(3) }}>
            {o.flags.map((f) => (
              <View key={f} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: colors.borderHi, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{f}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Card>

      <SectionLabel>Rates (all-in)</SectionLabel>
      <Card>
        <KeyValue k="Net per hour" v={fmtPerHour(o.netPerHour)} mono />
        <KeyValue k="Net per mile" v={fmtPerMile(o.netPerMile)} mono />
        <KeyValue k="Gross per hour" v={fmtPerHour(o.grossPerHour)} mono />
        <KeyValue k="Gross per mile" v={fmtPerMile(o.grossPerMile)} mono />
      </Card>

      <SectionLabel>Money</SectionLabel>
      <Card>
        <KeyValue k="Fare shown" v={fmtMoney(o.fare)} mono />
        <KeyValue k="Bonus / surge" v={o.surge != null ? `${fmtMoney(o.surge)}${o.surgeIncluded ? ' (included)' : ''}` : 'None shown'} mono />
        <KeyValue k="Total used for grading" v={fmtMoney(o.total)} mono />
        <KeyValue k={`Vehicle cost (${fmtMi(o.effMi)} × ${fmtMoney(costPerMile)})`} v={o.cost != null ? `−${fmtMoney(o.cost)}` : '—'} mono />
        <KeyValue k="Net" v={fmtMoney(o.net)} mono />
      </Card>

      <SectionLabel>Distance and time</SectionLabel>
      <Card>
        <KeyValue k="Pickup" v={`${fmtMin(o.pickupMin)} · ${fmtMi(o.pickupMi)}`} />
        <KeyValue k="Trip" v={`${fmtMin(o.tripMin)} · ${fmtMi(o.tripMi)}`} />
        {o.zoneClass === 'dead' ? <KeyValue k="Dead-zone return (penalty)" v="Added to totals below" /> : null}
        <KeyValue k="Effective total" v={`${fmtMin(o.effMin)} · ${fmtMi(o.effMi)}`} />
      </Card>

      <SectionLabel>Places (as shown on the card)</SectionLabel>
      <Card>
        <KeyValue k="Pickup area" v={o.pickupArea ?? 'Not read'} />
        <KeyValue k="Dropoff area" v={o.dropoffArea ?? 'Not read'} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: space(2) }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: zoneColor(o.zoneClass) }} />
          <Text style={type.bodyStrong}>
            {o.zoneClass === 'hot' ? 'Hot zone' : o.zoneClass === 'dead' ? 'Dead zone' : 'Neutral zone'}
            {o.zoneKeyword ? ` (matched "${o.zoneKeyword}")` : ''}
          </Text>
        </View>
      </Card>

      <SectionLabel>Card</SectionLabel>
      <Card>
        <KeyValue k="App" v={platformLabel(o.platform)} />
        <KeyValue k="Ride type" v={o.offerType ?? 'Not shown'} />
        <KeyValue k="Rider rating" v={o.riderRating != null ? `${o.riderRating.toFixed(2)} ★` : 'Not shown'} />
        <KeyValue k="Multiple stops" v={o.multiStop ? 'Yes' : 'No'} />
      </Card>

      <SectionLabel>Read quality</SectionLabel>
      <Card>
        <KeyValue k="Confidence" v={`${Math.round(o.confidence * 100)}%`} />
        <KeyValue k="How it was read" v={o.readPath === 'primary' ? 'Card regions (primary)' : 'Whole-card scan (fallback)'} />
        {o.fallbackFields.length ? (
          <KeyValue k="Fields from fallback" v={o.fallbackFields.map((f) => FIELD_LABELS[f] ?? f).join(', ')} />
        ) : null}
        <Text style={[type.label, { marginTop: space(4), marginBottom: space(2) }]}>Text read from the card</Text>
        <View style={{ backgroundColor: colors.bgElevated, borderRadius: radius.sm, padding: space(3), borderWidth: 1, borderColor: colors.border }}>
          <Text selectable style={{ color: colors.textSecondary, fontFamily: 'monospace', fontSize: 13, lineHeight: 19 }}>
            {o.rawText || '(empty)'}
          </Text>
        </View>
        <Text style={[type.tiny, { marginTop: space(2) }]}>Rider names are removed before saving and appear as [rider].</Text>
      </Card>

      <Button label="Delete this offer" variant="danger" onPress={confirmDelete} style={{ marginTop: space(8) }} />
    </Screen>
  );
}
