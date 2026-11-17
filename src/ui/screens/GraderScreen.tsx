import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { SAMPLE_CARDS } from '../../config/samples';
import { gradeParsed } from '../../engine/evaluate';
import { CURRENCIES, fromUnit, getMarket, toUnit, type MoneyFormat } from '../../engine/market';
import type { GradeResult, ParsedOffer } from '../../engine/types';
import { useStore } from '../../state/createStore';
import { appStore } from '../../state/appStore';
import { settingsStore } from '../../state/settingsStore';
import { evaluateCard, showVerdictOverlay, type Evaluation } from '../../state/watchController';
import { Button, Card, Chip, KeyValue, Notice, NumberField, RateHeadline, Screen, SectionLabel, TextField, TopBar } from '../components';
import { fmtMi, fmtMin, fmtMoney, fmtRating } from '../format';
import { useNav } from '../navigation';
import { colors, space, type } from '../theme';

const blankParsed = (): ParsedOffer => ({
  platform: 'unknown',
  fare: 18,
  surge: null,
  surgeIncluded: false,
  pickupMi: 2,
  pickupMin: 6,
  tripMi: 10,
  tripMin: 22,
  totalMi: null,
  totalMin: null,
  pickupArea: null,
  dropoffArea: 'Arlington',
  riderRating: null,
  offerType: null,
  currency: null,
  distanceUnit: null,
  multiStop: false,
  stopCount: null,
  readPath: 'primary',
  fallbackFields: [],
  confidence: 1,
  rawText: '',
});

/** Manual + sample-card testing of the whole grade → overlay path, without a live offer. */
export function GraderScreen() {
  const nav = useNav();
  const settings = useStore(settingsStore, (s) => s.settings);
  const zones = useStore(settingsStore, (s) => s.zones);
  const overlayAllowed = useStore(appStore, (s) => s.overlayAllowed);
  const [p, setP] = useState<ParsedOffer>(blankParsed);
  const [sample, setSample] = useState<Evaluation | null>(null);
  const [overlayMsg, setOverlayMsg] = useState<string | null>(null);

  const home = getMarket(settings.market.home);
  const unit = home.unit;
  const sym = CURRENCIES[home.currency].symbol.trim();
  const suffixCur = !!CURRENCIES[home.currency].suffix;
  // Typed-in offers are in the home market's currency.
  const typed = useMemo(() => gradeParsed({ ...p, currency: home.currency }, settings, zones), [p, settings, zones, home.currency]);
  const set = (patch: Partial<ParsedOffer>) => setP((x) => ({ ...x, ...patch }));
  const dist = (mi: number | null) => (mi == null ? 0 : toUnit(mi, unit));

  const preview = async (ev: Evaluation) => {
    const ok = await showVerdictOverlay(ev, { top: 0.5, bottom: 0.95 });
    setOverlayMsg(ok ? 'Overlay shown on the lower half of the screen, where an offer card would be.' : 'Overlay permission is off, so nothing can be shown on top.');
  };

  return (
    <Screen>
      <TopBar title="Try the grader" subtitle={`${home.name} · ${home.currency} · ${unit}`} onBack={nav.pop} />
      <Text style={type.body}>Type in an offer to see how your settings grade it. Nothing here is saved to History.</Text>

      <ResultCard grade={typed.grade} fmt={typed.fmt} />
      <Button label="Show this on the overlay" variant="secondary" onPress={() => void preview(typed)} style={{ marginTop: space(3) }} />
      {overlayMsg ? <Text style={[type.small, { marginTop: space(2) }]}>{overlayMsg}</Text> : null}

      <SectionLabel>Offer</SectionLabel>
      <Card style={{ paddingVertical: 0 }}>
        <NumberField label="Fare" value={p.fare ?? 0} prefix={suffixCur ? undefined : sym} suffix={suffixCur ? sym : undefined} onCommit={(n) => set({ fare: n })} />
        <NumberField
          label="Separate bonus"
          help="0 if none"
          value={p.surge ?? 0}
          prefix={suffixCur ? undefined : sym}
          suffix={suffixCur ? sym : undefined}
          onCommit={(n) => set({ surge: n > 0 ? n : null })}
        />
        <NumberField label="Pickup distance" value={dist(p.pickupMi)} suffix={unit} decimals={1} onCommit={(n) => set({ pickupMi: fromUnit(n, unit) })} />
        <NumberField label="Pickup minutes" value={p.pickupMin ?? 0} suffix="min" decimals={0} onCommit={(n) => set({ pickupMin: n })} />
        <NumberField label="Trip distance" value={dist(p.tripMi)} suffix={unit} decimals={1} onCommit={(n) => set({ tripMi: fromUnit(n, unit) })} />
        <NumberField label="Trip minutes" value={p.tripMin ?? 0} suffix="min" decimals={0} onCommit={(n) => set({ tripMin: n })} />
        <NumberField label="Rider rating" help="0 if not shown" value={p.riderRating ?? 0} suffix="★" decimals={2} onCommit={(n) => set({ riderRating: n > 0 ? Math.min(5, n) : null })} />
        <View style={{ paddingBottom: space(3) }}>
          <TextField label="Dropoff area" value={p.dropoffArea ?? ''} onChangeText={(t) => set({ dropoffArea: t })} autoCapitalize="words" placeholder="e.g. Warrenton" />
        </View>
      </Card>

      <SectionLabel>Run a sample offer card</SectionLabel>
      <Text style={[type.small, { marginBottom: space(3) }]}>
        Feeds sample card text through the same reader and grader used for live offers, including currency and unit detection.
      </Text>
      <View style={{ gap: space(3) }}>
        {SAMPLE_CARDS.map((c) => (
          <Button
            key={c.id}
            label={c.label}
            variant="secondary"
            onPress={() => {
              const ev = evaluateCard(c.text);
              setSample(ev);
              void preview(ev);
            }}
          />
        ))}
      </View>
      {!overlayAllowed ? (
        <View style={{ marginTop: space(3) }}>
          <Notice tone="warn" title="Overlay is off" body="Results show here, but nothing can pop up on top until you allow the overlay." />
        </View>
      ) : null}
      {sample ? (
        <>
          <ResultCard grade={sample.grade} fmt={sample.fmt} />
          <Card style={{ marginTop: space(3), paddingVertical: 0 }}>
            <Text style={[type.label, { paddingTop: space(4) }]}>What was read</Text>
            <KeyValue k="Currency / unit" v={`${sample.parsed.currency ?? '—'} · ${sample.parsed.distanceUnit ?? '—'} → ${getMarket(sample.market).name}`} />
            <KeyValue k="Fare" v={fmtMoney(sample.parsed.fare, sample.fmt)} />
            {sample.parsed.surge != null ? <KeyValue k="Bonus" v={fmtMoney(sample.parsed.surge, sample.fmt)} /> : null}
            <KeyValue k="Pickup" v={`${fmtMin(sample.parsed.pickupMin)} · ${fmtMi(sample.parsed.pickupMi, sample.fmt)}`} />
            <KeyValue k="Trip" v={`${fmtMin(sample.parsed.tripMin)} · ${fmtMi(sample.parsed.tripMi, sample.fmt)}`} />
            <KeyValue k="Total" v={`${fmtMin(sample.grade.totalMin)} · ${fmtMi(sample.grade.totalMi, sample.fmt)}`} />
            <KeyValue k="Rider rating" v={sample.parsed.riderRating != null ? `★ ${fmtRating(sample.parsed.riderRating, sample.fmt)}` : 'Not shown'} />
            <KeyValue k="Dropoff" v={sample.parsed.dropoffArea ?? 'Not read'} />
            <KeyValue k="Read path" v={sample.parsed.readPath} />
            <KeyValue k="Confidence" v={`${Math.round(sample.parsed.confidence * 100)}%`} last />
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function ResultCard({ grade, fmt }: { grade: GradeResult; fmt: MoneyFormat }) {
  return (
    <Card tone={grade.verdict ?? 'CHECK'} style={{ marginTop: space(5) }}>
      <RateHeadline verdict={grade.verdict} netPerHour={grade.netPerHour} netPerMile={grade.netPerMile} reason={grade.reason} fmt={fmt} />
      {grade.flags.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2), marginTop: space(3) }}>
          {grade.flags.map((f) => (
            <Chip key={f} label={f} />
          ))}
        </View>
      ) : null}
      {grade.gradable ? (
        <Text style={[type.tiny, { marginTop: space(3), color: colors.textSecondary }]}>
          {fmtMoney(grade.total, fmt)} − {fmtMoney(grade.cost, fmt)} car cost = {fmtMoney(grade.net, fmt)} net over{' '}
          {fmtMi(grade.effMi, fmt)} and {fmtMin(grade.effMin)}
          {grade.penaltyApplied ? ' (incl. dead-zone return)' : ' (total: pickup + trip)'}
        </Text>
      ) : null}
    </Card>
  );
}
