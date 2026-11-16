import React, { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenWatcher } from '../../../modules/screen-watcher';
import { DEFAULT_GRADING, DEFAULT_SETTINGS } from '../../config/defaults';
import {
  CURRENCIES,
  fromUnit,
  getMarket,
  MARKETS,
  profileFor,
  toUnit,
  type MarketCode,
  type MarketProfile,
} from '../../engine/market';
import { SAMPLE_CARDS } from '../../config/samples';
import { isValidBaseUrl } from '../../config/validate';
import { clearHistory } from '../../db/database';
import type { GradingSettings } from '../../engine/types';
import { configureSync, isSyncActive, refreshPendingCount, syncNow } from '../../sync/syncService';
import { useStore } from '../../state/createStore';
import { appStore, bumpHistory } from '../../state/appStore';
import { resetProfile, settingsStore, updateMarket, updateProfile, updateSettings } from '../../state/settingsStore';
import { evaluateCard, refreshOverlayPermission, showVerdictOverlay } from '../../state/watchController';
import {
  Button,
  Card,
  Divider,
  ListRow,
  Notice,
  NumberField,
  PageHeader,
  SectionLabel,
  Segmented,
  TextField,
  ToggleRow,
} from '../components';
import { fmtTime } from '../format';
import { useNav } from '../navigation';
import { colors, radius, space, type } from '../theme';

export function SettingsScreen() {
  const nav = useNav();
  const settings = useStore(settingsStore, (s) => s.settings);
  const zones = useStore(settingsStore, (s) => s.zones);
  const overlayAllowed = useStore(appStore, (s) => s.overlayAllowed);
  const g = settings.grading;
  const ms = settings.market;
  const home = getMarket(ms.home);
  const unit = home.unit;
  const unitWord = unit === 'km' ? 'km' : 'mi';
  const [editing, setEditing] = useState<MarketCode>(ms.home);
  const [picker, setPicker] = useState<null | 'home' | 'edit'>(null);
  useEffect(() => setEditing(ms.home), [ms.home]);

  const setG = (patch: Partial<GradingSettings>) => void updateSettings((s) => ({ ...s, grading: { ...s.grading, ...patch } }));

  const counts = {
    hot: zones.filter((z) => z.zoneClass === 'hot').length,
    neutral: zones.filter((z) => z.zoneClass === 'neutral').length,
    dead: zones.filter((z) => z.zoneClass === 'dead').length,
  };

  useEffect(() => {
    refreshOverlayPermission();
  }, []);

  return (
    <View>
      <PageHeader kicker="Changes apply to the next offer" title="Settings" />

      <SectionLabel>Market and currency</SectionLabel>
      <Card style={styles.group}>
        <ListRow
          title="Where you drive"
          subtitle={`${home.name} · ${home.currency} · ${unit === 'km' ? 'kilometres' : 'miles'}`}
          actionLabel="Change"
          onPress={() => setPicker('home')}
        />
        <ToggleRow
          label="Detect currency from each offer"
          help={`Reads the currency on the card ($, €, £, E£, SAR…). A card in another currency is graded with that market's settings. A plain "$" means ${CURRENCIES[home.currency].dollar ? home.currency : 'USD'}.`}
          value={ms.autoDetect}
          onChange={(v) => void updateMarket({ autoDetect: v })}
          last
        />
      </Card>

      <MarketProfileEditor
        code={editing}
        isHome={editing === ms.home}
        profile={profileFor(ms, editing)}
        customized={ms.profiles[editing] != null}
        onPickMarket={() => setPicker('edit')}
      />

      <SectionLabel>Dead-zone dropoffs</SectionLabel>
      <Card style={styles.group}>
        <Text style={[type.small, { paddingTop: space(4) }]}>A trip ending in a dead zone counts the drive back as part of the ride.</Text>
        <NumberField label="Extra minutes to get back" value={g.deadZoneExtraMinutes} suffix="min" decimals={0} onCommit={(n) => setG({ deadZoneExtraMinutes: n })} />
        <NumberField
          label={`Extra ${unit === 'km' ? 'kilometres' : 'miles'} to get back`}
          value={toUnit(g.deadZoneExtraMiles, unit)}
          suffix={unitWord}
          decimals={1}
          onCommit={(n) => setG({ deadZoneExtraMiles: fromUnit(n, unit) })}
        />
        <ListRow
          title="Edit zones"
          subtitle={`${counts.hot} hot · ${counts.neutral} neutral · ${counts.dead} dead`}
          actionLabel="Edit"
          onPress={() => nav.push({ name: 'zones' })}
          last
        />
      </Card>

      <SectionLabel>Warnings</SectionLabel>
      <Card style={styles.group}>
        <NumberField label="Long trip: minutes" help="Flag trips at least this long" value={g.longTripMinutes} suffix="min" decimals={0} onCommit={(n) => setG({ longTripMinutes: n })} />
        <NumberField
          label={`Long trip: ${unit === 'km' ? 'kilometres' : 'miles'}`}
          value={toUnit(g.longTripMiles, unit)}
          suffix={unitWord}
          decimals={0}
          onCommit={(n) => setG({ longTripMiles: fromUnit(n, unit) })}
        />
        <NumberField label="Long pickup: minutes" value={g.longPickupMinutes} suffix="min" decimals={0} onCommit={(n) => setG({ longPickupMinutes: n })} />
        <NumberField label="Flag rider rating below" value={g.lowRatingBelow} suffix="★" decimals={2} onCommit={(n) => setG({ lowRatingBelow: n })} />
        <ToggleRow
          label="Add separate bonus to fare"
          help='When a card shows "+$3.00" that is not marked included, count it as pay.'
          value={g.addSeparateBonus}
          onChange={(v) => setG({ addSeparateBonus: v })}
          last
        />
      </Card>
      <Button
        label="Reset warnings and zones penalty to defaults"
        variant="ghost"
        size="sm"
        style={{ marginTop: space(2) }}
        onPress={() =>
          setG({
            deadZoneExtraMinutes: DEFAULT_GRADING.deadZoneExtraMinutes,
            deadZoneExtraMiles: DEFAULT_GRADING.deadZoneExtraMiles,
            longTripMinutes: DEFAULT_GRADING.longTripMinutes,
            longTripMiles: DEFAULT_GRADING.longTripMiles,
            longPickupMinutes: DEFAULT_GRADING.longPickupMinutes,
            lowRatingBelow: DEFAULT_GRADING.lowRatingBelow,
            addSeparateBonus: DEFAULT_GRADING.addSeparateBonus,
            assumedAvgMph: DEFAULT_GRADING.assumedAvgMph,
          })
        }
      />

      <MarketPicker
        visible={picker != null}
        title={picker === 'home' ? 'Where do you drive?' : 'Edit settings for…'}
        selected={picker === 'home' ? ms.home : editing}
        customized={ms.profiles}
        onClose={() => setPicker(null)}
        onPick={(code) => {
          if (picker === 'home') void updateMarket({ home: code });
          else setEditing(code);
          setPicker(null);
        }}
      />

      <SectionLabel>Overlay</SectionLabel>
      <Card style={{ gap: space(3) }}>
        <NumberField
          label="Show verdict for"
          help="It also disappears as soon as the offer card does."
          value={settings.overlay.seconds}
          suffix="sec"
          decimals={0}
          onCommit={(n) => void updateSettings((s) => ({ ...s, overlay: { ...s.overlay, seconds: n } }))}
        />
        <Text style={type.bodyStrong}>Position</Text>
        <Segmented
          options={[
            { value: 'card', label: 'On the offer' },
            { value: 'top', label: 'Top' },
            { value: 'center', label: 'Middle' },
          ]}
          value={settings.overlay.position}
          onChange={(v) => void updateSettings((s) => ({ ...s, overlay: { ...s.overlay, position: v } }))}
        />
        <Text style={type.small}>
          {settings.overlay.position === 'card'
            ? 'Floats on top of the Uber/Lyft offer card, keeping the Accept button clear.'
            : settings.overlay.position === 'top'
              ? 'Always at the top of the screen.'
              : 'Always in the middle of the screen.'}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: overlayAllowed ? colors.great : colors.ok }} />
          <Text style={type.small}>Display over other apps: {overlayAllowed ? 'allowed' : 'not allowed'}</Text>
        </View>
        {!overlayAllowed ? (
          <Button label="Open overlay setting" variant="secondary" onPress={() => void ScreenWatcher.openOverlaySettings()} />
        ) : (
          <Button
            label="Preview the overlay"
            variant="secondary"
            onPress={() => void showVerdictOverlay(evaluateCard(SAMPLE_CARDS[0].text), { top: 0.5, bottom: 0.95 })}
          />
        )}
        <ListRow title="Try the grader" subtitle="Type in an offer or run a sample card" actionLabel="Open" onPress={() => nav.push({ name: 'grader' })} />
      </Card>

      <SectionLabel>Driver</SectionLabel>
      <Card>
        <DriverIdField />
      </Card>

      <SyncSection />

      <SectionLabel>Your data</SectionLabel>
      <Card style={{ gap: space(3) }}>
        <Text style={type.small}>
          History is stored only on this phone. Rider names are never saved. No ads, no analytics. Screen images are
          read and discarded instantly; only the card text is kept.
        </Text>
        <Button
          label="Delete all history"
          variant="danger"
          onPress={() =>
            Alert.alert('Delete all history?', 'All offers and wait records on this phone will be erased. Settings and zones are kept.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete everything',
                style: 'destructive',
                onPress: async () => {
                  await clearHistory();
                  bumpHistory();
                  void refreshPendingCount();
                },
              },
            ])
          }
        />
        <Button
          label="Reset all settings"
          variant="ghost"
          onPress={() =>
            Alert.alert('Reset all settings?', 'Thresholds, overlay and sync settings go back to defaults. Sync will be turned off.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Reset',
                style: 'destructive',
                onPress: async () => {
                  await updateSettings(() => DEFAULT_SETTINGS);
                  configureSync();
                },
              },
            ])
          }
        />
      </Card>
      <Text style={[type.tiny, { textAlign: 'center', marginTop: space(6) }]}>RideOffer Copilot 1.0.0 (11) · Not affiliated with Uber or Lyft</Text>
    </View>
  );
}

function money(code: MarketCode) {
  const c = CURRENCIES[getMarket(code).currency];
  return c.suffix ? { prefix: undefined, suffix: c.symbol.trim() } : { prefix: c.symbol.trim(), suffix: undefined };
}

/** Cost and GREAT/BAD thresholds for one market, in its own currency and unit. */
function MarketProfileEditor({
  code,
  isHome,
  profile,
  customized,
  onPickMarket,
}: {
  code: MarketCode;
  isHome: boolean;
  profile: MarketProfile;
  customized: boolean;
  onPickMarket: () => void;
}) {
  const m = getMarket(code);
  const u = m.unit === 'km' ? 'km' : 'mi';
  const cur = money(code);
  const per = (s: string) => (cur.suffix ? `${cur.suffix}${s}` : s);
  const set = (patch: Partial<MarketProfile>) => void updateProfile(code, patch);
  return (
    <>
      <SectionLabel
        right={
          <Pressable onPress={onPickMarket} accessibilityRole="button" accessibilityLabel="Edit another market" hitSlop={8}>
            <Text style={styles.link}>Other market ›</Text>
          </Pressable>
        }
      >
        {`Costs and verdicts · ${m.name}${isHome ? '' : ' (not home)'}`}
      </SectionLabel>
      <Card style={styles.group}>
        <NumberField
          label={`Car cost per ${m.unit === 'km' ? 'km' : 'mile'}`}
          help={`Fuel, maintenance, tires and wear for each ${m.unit === 'km' ? 'kilometre' : 'mile'} you drive.`}
          value={profile.costPerUnit}
          prefix={cur.prefix}
          suffix={per(`/${u}`)}
          decimals={3}
          onCommit={(n) => set({ costPerUnit: n })}
        />
        <View style={styles.tierHead}>
          <View style={[styles.tierDot, { backgroundColor: colors.great }]} />
          <Text style={[type.bodyStrong, { color: colors.great }]}>GREAT needs both</Text>
        </View>
        <NumberField label={`Net per ${u}, at least`} value={profile.greatMinNetPerUnit} prefix={cur.prefix} suffix={per(`/${u}`)} decimals={3} onCommit={(n) => set({ greatMinNetPerUnit: n })} />
        <NumberField label="Net per hour, at least" value={profile.greatMinNetPerHour} prefix={cur.prefix} suffix={per('/hr')} decimals={m.currency === 'KWD' || m.currency === 'JOD' ? 1 : 0} onCommit={(n) => set({ greatMinNetPerHour: n })} />
        <View style={styles.tierHead}>
          <View style={[styles.tierDot, { backgroundColor: colors.bad }]} />
          <Text style={[type.bodyStrong, { color: colors.bad }]}>BAD if either is below</Text>
        </View>
        <NumberField label={`Net per ${u} below`} value={profile.badBelowNetPerUnit} prefix={cur.prefix} suffix={per(`/${u}`)} decimals={3} onCommit={(n) => set({ badBelowNetPerUnit: n })} />
        <NumberField label="Net per hour below" value={profile.badBelowNetPerHour} prefix={cur.prefix} suffix={per('/hr')} decimals={m.currency === 'KWD' || m.currency === 'JOD' ? 1 : 0} onCommit={(n) => set({ badBelowNetPerHour: n })} last />
      </Card>
      <Text style={[type.small, { marginTop: space(3), paddingHorizontal: space(1) }]}>
        Everything in between is OK. Rates are net of car cost and use the total distance and time, pickup included.
        {code !== 'US' && !customized ? ' These start from the US defaults converted to this currency and unit; set them to what works where you drive.' : ''}
      </Text>
      {customized ? (
        <Button label={`Reset ${m.name} to defaults`} variant="ghost" size="sm" style={{ marginTop: space(2) }} onPress={() => void resetProfile(code)} />
      ) : null}
    </>
  );
}

function MarketPicker({
  visible,
  title,
  selected,
  customized,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  selected: MarketCode;
  customized: Partial<Record<MarketCode, MarketProfile>>;
  onPick: (code: MarketCode) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space(4) }]}>
        <View style={styles.grabber} />
        <Text style={[type.h2, { marginBottom: space(3) }]}>{title}</Text>
        <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
          {MARKETS.map((m, i) => {
            const active = m.code === selected;
            return (
              <Pressable
                key={m.code}
                onPress={() => onPick(m.code)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.marketRow,
                  i < MARKETS.length - 1 && styles.marketBorder,
                  active && { backgroundColor: colors.accentSoft },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[type.bodyStrong, active && { color: colors.accent }]}>{m.name}</Text>
                  <Text style={type.tiny}>
                    {m.currency} · {m.unit === 'km' ? 'kilometres' : 'miles'}
                    {customized[m.code] ? ' · your settings' : ''}
                  </Text>
                </View>
                {active ? <Text style={{ color: colors.accent, fontWeight: '900', fontSize: 18 }}>✓</Text> : null}
              </Pressable>
            );
          })}
        </ScrollView>
        <Button label="Close" variant="secondary" onPress={onClose} style={{ marginTop: space(3) }} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  group: { paddingVertical: 0 },
  link: { color: colors.accent, fontWeight: '800', fontSize: 13 },
  tierHead: { flexDirection: 'row', alignItems: 'center', gap: space(2), paddingTop: space(4), paddingBottom: space(1) },
  tierDot: { width: 8, height: 8, borderRadius: 4 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderHi,
    paddingHorizontal: space(5),
    paddingTop: space(3),
  },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.raised, marginBottom: space(4) },
  marketRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space(3), paddingHorizontal: space(3), borderRadius: radius.sm, minHeight: 56 },
  marketBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});

function DriverIdField() {
  const driverId = useStore(settingsStore, (s) => s.settings.driverId);
  const [v, setV] = useState(driverId);
  useEffect(() => setV(driverId), [driverId]);
  return (
    <TextField
      label="Driver ID"
      help="Optional label included in exports and sync, e.g. your initials. Not shared unless you export or sync."
      value={v}
      onChangeText={setV}
      onBlur={() => void updateSettings((s) => ({ ...s, driverId: v }))}
      placeholder="e.g. AA-01"
      autoCapitalize="characters"
    />
  );
}

function SyncSection() {
  const sync = useStore(settingsStore, (s) => s.settings.sync);
  const status = useStore(appStore, (s) => s.sync);
  const [url, setUrl] = useState(sync.baseUrl);
  const [key, setKey] = useState(sync.driverKey);
  useEffect(() => setUrl(sync.baseUrl), [sync.baseUrl]);
  useEffect(() => setKey(sync.driverKey), [sync.driverKey]);

  const save = async (patch: Partial<typeof sync>) => {
    await updateSettings((s) => ({ ...s, sync: { ...s.sync, ...patch } }));
    configureSync();
  };

  const outcome = status.lastOutcome;
  const outcomeText =
    !outcome
      ? 'Not synced yet'
      : outcome.kind === 'synced'
        ? `Sent ${outcome.count} record(s)`
        : outcome.kind === 'key_rejected'
          ? 'Key rejected'
          : outcome.kind === 'failed'
            ? `Failed: ${outcome.message}. Records stay queued.`
            : outcome.kind === 'nothing'
              ? 'Everything is already synced'
              : 'Sync is off';

  return (
    <>
      <SectionLabel>Sync (optional)</SectionLabel>
      <Card>
        <ToggleRow
          label="Send history to my server"
          help="Off by default. While off, the app makes zero network connections."
          value={sync.enabled}
          onChange={(v) => void save({ enabled: v })}
        />
        {sync.enabled ? (
          <>
            <TextField
              label="Server address"
              help="Must start with https://. Records are sent to {address}/api/rideoffer/v1/ingest."
              value={url}
              onChangeText={setUrl}
              onBlur={() => void save({ baseUrl: url })}
              placeholder="https://example.com"
            />
            {url.length > 0 && !isValidBaseUrl(url) ? (
              <Text style={[type.small, { color: colors.ok }]}>Enter a full https:// address.</Text>
            ) : null}
            <TextField
              label="Personal key"
              help="Sent as the X-Driver-Key header."
              value={key}
              onChangeText={setKey}
              onBlur={() => void save({ driverKey: key })}
              secure
              placeholder="Paste your key"
            />
            {status.keyRejected ? (
              <View style={{ marginVertical: space(2) }}>
                <Notice tone="bad" title="Key rejected" body="The server answered 401. Check your personal key; records stay queued on this phone." />
              </View>
            ) : null}
            <Divider />
            <Text style={type.bodyStrong}>{outcomeText}</Text>
            <Text style={[type.small, { marginTop: 2 }]}>
              {status.pending} record(s) waiting
              {status.lastAttemptAt ? ` · last try ${fmtTime(status.lastAttemptAt)}` : ''}
            </Text>
            <Button
              label="Sync now"
              variant="secondary"
              loading={status.busy}
              disabled={!isSyncActive()}
              onPress={() => void syncNow({ manual: true })}
              style={{ marginTop: space(3) }}
            />
            {!isSyncActive() ? (
              <Text style={[type.tiny, { marginTop: space(2) }]}>Add a valid https address and a key to start syncing.</Text>
            ) : null}
          </>
        ) : null}
      </Card>
    </>
  );
}
