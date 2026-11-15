import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { SAMPLE_CARDS } from '../../config/samples';
import { gradeOffer } from '../../engine/grading';
import type { GradeResult, ParsedOffer } from '../../engine/types';
import { useStore } from '../../state/createStore';
import { appStore } from '../../state/appStore';
import { settingsStore } from '../../state/settingsStore';
import { evaluateCard, showVerdictOverlay, type Evaluation } from '../../state/watchController';
import { Button, Card, KeyValue, Notice, NumberField, RateHeadline, Screen, SectionLabel, TextField, TopBar } from '../components';
import { fmtMi, fmtMin, fmtMoney } from '../format';
import { useNav } from '../navigation';
import { colors, space, type, verdictColor } from '../theme';

const blankParsed = (): ParsedOffer => ({
  platform: 'unknown',
  fare: 18,
  surge: null,
  surgeIncluded: false,
  pickupMi: 2,
  pickupMin: 6,
  tripMi: 10,
  tripMin: 22,
  pickupArea: null,
  dropoffArea: 'Arlington',
  riderRating: null,
  offerType: null,
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

  const grade = useMemo(() => gradeOffer(p, settings.grading, zones), [p, settings.grading, zones]);
  const set = (patch: Partial<ParsedOffer>) => setP((x) => ({ ...x, ...patch }));

  const preview = async (ev: Evaluation) => {
    const ok = await showVerdictOverlay(ev);
    setOverlayMsg(ok ? 'Overlay shown at the top of the screen.' : 'Overlay permission is off, so nothing can be shown on top.');
  };

  return (
    <Screen>
      <TopBar title="Try the grader" onBack={nav.pop} />
      <Text style={type.body}>Type in an offer to see how your settings grade it. Nothing here is saved to History.</Text>

      <ResultCard grade={grade} />
      <Button label="Show this on the overlay" variant="secondary" onPress={() => void preview({ parsed: p, grade })} style={{ marginTop: space(3) }} />
      {overlayMsg ? <Text style={[type.small, { marginTop: space(2) }]}>{overlayMsg}</Text> : null}

      <SectionLabel>Offer</SectionLabel>
      <Card>
        <NumberField label="Fare" value={p.fare ?? 0} prefix="$" onCommit={(n) => set({ fare: n })} />
        <NumberField label="Separate bonus" help="0 if none" value={p.surge ?? 0} prefix="$" onCommit={(n) => set({ surge: n > 0 ? n : null })} />
        <NumberField label="Pickup miles" value={p.pickupMi ?? 0} suffix="mi" decimals={1} onCommit={(n) => set({ pickupMi: n })} />
        <NumberField label="Pickup minutes" value={p.pickupMin ?? 0} suffix="min" decimals={0} onCommit={(n) => set({ pickupMin: n })} />
        <NumberField label="Trip miles" value={p.tripMi ?? 0} suffix="mi" decimals={1} onCommit={(n) => set({ tripMi: n })} />
        <NumberField label="Trip minutes" value={p.tripMin ?? 0} suffix="min" decimals={0} onCommit={(n) => set({ tripMin: n })} />
        <TextField label="Dropoff area" value={p.dropoffArea ?? ''} onChangeText={(t) => set({ dropoffArea: t })} autoCapitalize="words" placeholder="e.g. Warrenton" />
      </Card>

      <SectionLabel>Run a sample offer card</SectionLabel>
      <Text style={[type.small, { marginBottom: space(3) }]}>
        Feeds sample card text through the same reader and grader used for live offers.
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
          <ResultCard grade={sample.grade} />
          <Card style={{ marginTop: space(3) }}>
            <Text style={type.label}>What was read</Text>
            <KeyValue k="Fare" v={fmtMoney(sample.parsed.fare)} />
            <KeyValue k="Pickup" v={`${fmtMin(sample.parsed.pickupMin)} · ${fmtMi(sample.parsed.pickupMi)}`} />
            <KeyValue k="Trip" v={`${fmtMin(sample.parsed.tripMin)} · ${fmtMi(sample.parsed.tripMi)}`} />
            <KeyValue k="Dropoff" v={sample.parsed.dropoffArea ?? 'Not read'} />
            <KeyValue k="Read path" v={sample.parsed.readPath} />
            <KeyValue k="Confidence" v={`${Math.round(sample.parsed.confidence * 100)}%`} />
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function ResultCard({ grade }: { grade: GradeResult }) {
  const vc = verdictColor(grade.verdict);
  return (
    <Card style={{ marginTop: space(5), borderColor: vc.fg, backgroundColor: vc.soft }}>
      <RateHeadline
        verdict={grade.verdict}
        netPerHour={grade.netPerHour}
        netPerMile={grade.netPerMile}
        reason={grade.reason}
        detail={grade.flags.length ? grade.flags.join(' · ') : undefined}
      />
      {grade.gradable ? (
        <Text style={[type.tiny, { marginTop: space(3), color: colors.textSecondary }]}>
          {fmtMoney(grade.total)} − {fmtMoney(grade.cost)} car cost = {fmtMoney(grade.net)} net over {fmtMi(grade.effMi)} and{' '}
          {fmtMin(grade.effMin)}
          {grade.penaltyApplied ? ' (incl. dead-zone return)' : ''}
        </Text>
      ) : null}
    </Card>
  );
}
