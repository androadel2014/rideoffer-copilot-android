import React, { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { ScreenWatcher } from '../../../modules/screen-watcher';
import { DEFAULT_GRADING, DEFAULT_SETTINGS } from '../../config/defaults';
import { SAMPLE_CARDS } from '../../config/samples';
import { isValidBaseUrl } from '../../config/validate';
import { clearHistory } from '../../db/database';
import type { GradingSettings } from '../../engine/types';
import { configureSync, isSyncActive, refreshPendingCount, syncNow } from '../../sync/syncService';
import { useStore } from '../../state/createStore';
import { appStore, bumpHistory } from '../../state/appStore';
import { settingsStore, updateSettings } from '../../state/settingsStore';
import { evaluateCard, refreshOverlayPermission, showVerdictOverlay } from '../../state/watchController';
import { Button, Card, Divider, ListRow, Notice, NumberField, SectionLabel, Segmented, TextField, ToggleRow } from '../components';
import { fmtTime } from '../format';
import { useNav } from '../navigation';
import { colors, space, type } from '../theme';

export function SettingsScreen() {
  const nav = useNav();
  const settings = useStore(settingsStore, (s) => s.settings);
  const zones = useStore(settingsStore, (s) => s.zones);
  const overlayAllowed = useStore(appStore, (s) => s.overlayAllowed);
  const g = settings.grading;

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
      <Text style={[type.h1, { marginBottom: space(2) }]}>Settings</Text>
      <Text style={type.small}>Changes apply to the next offer immediately.</Text>

      <SectionLabel>Your car</SectionLabel>
      <Card>
        <NumberField
          label="Cost per mile"
          help="Gas, maintenance, tires and wear for each mile you drive. About $0.30 for an efficient sedan; raise it for an SUV."
          value={g.costPerMile}
          prefix="$"
          onCommit={(n) => setG({ costPerMile: n })}
        />
      </Card>

      <SectionLabel>Verdict thresholds (net, after car cost)</SectionLabel>
      <Card>
        <Text style={[type.bodyStrong, { color: colors.great }]}>GREAT needs both</Text>
        <NumberField label="At least, per mile" value={g.greatMinNetPerMile} prefix="$" suffix="/mi" onCommit={(n) => setG({ greatMinNetPerMile: n })} />
        <NumberField label="At least, per hour" value={g.greatMinNetPerHour} prefix="$" suffix="/hr" decimals={0} onCommit={(n) => setG({ greatMinNetPerHour: n })} />
        <Divider />
        <Text style={[type.bodyStrong, { color: colors.bad }]}>BAD if either is below</Text>
        <NumberField label="Per mile below" value={g.badBelowNetPerMile} prefix="$" suffix="/mi" onCommit={(n) => setG({ badBelowNetPerMile: n })} />
        <NumberField label="Per hour below" value={g.badBelowNetPerHour} prefix="$" suffix="/hr" decimals={0} onCommit={(n) => setG({ badBelowNetPerHour: n })} />
        <Text style={[type.small, { marginTop: space(2) }]}>Everything in between is OK. Rates include the drive to the pickup.</Text>
      </Card>

      <SectionLabel>Dead-zone dropoffs</SectionLabel>
      <Card>
        <Text style={type.small}>A trip ending in a dead zone counts the drive back as part of the ride.</Text>
        <NumberField label="Extra minutes to get back" value={g.deadZoneExtraMinutes} suffix="min" decimals={0} onCommit={(n) => setG({ deadZoneExtraMinutes: n })} />
        <NumberField label="Extra miles to get back" value={g.deadZoneExtraMiles} suffix="mi" decimals={1} onCommit={(n) => setG({ deadZoneExtraMiles: n })} />
        <Divider />
        <ListRow
          title="Edit zones"
          subtitle={`${counts.hot} hot · ${counts.neutral} neutral · ${counts.dead} dead`}
          actionLabel="Edit"
          onPress={() => nav.push({ name: 'zones' })}
        />
      </Card>

      <SectionLabel>Warnings</SectionLabel>
      <Card>
        <NumberField label="Long trip: minutes" help="Flag trips at least this long" value={g.longTripMinutes} suffix="min" decimals={0} onCommit={(n) => setG({ longTripMinutes: n })} />
        <NumberField label="Long trip: miles" value={g.longTripMiles} suffix="mi" decimals={0} onCommit={(n) => setG({ longTripMiles: n })} />
        <NumberField label="Long pickup: minutes" value={g.longPickupMinutes} suffix="min" decimals={0} onCommit={(n) => setG({ longPickupMinutes: n })} />
        <NumberField label="Flag rider rating below" value={g.lowRatingBelow} suffix="★" decimals={2} onCommit={(n) => setG({ lowRatingBelow: n })} />
        <ToggleRow
          label="Add separate bonus to fare"
          help='When a card shows "+$3.00" that is not marked included, count it as pay.'
          value={g.addSeparateBonus}
          onChange={(v) => setG({ addSeparateBonus: v })}
        />
        <Button label="Reset grading to DC defaults" variant="ghost" onPress={() => setG({ ...DEFAULT_GRADING })} />
      </Card>

      <SectionLabel>Overlay</SectionLabel>
      <Card style={{ gap: space(2) }}>
        <NumberField
          label="Show verdict for"
          value={settings.overlay.seconds}
          suffix="sec"
          decimals={0}
          onCommit={(n) => void updateSettings((s) => ({ ...s, overlay: { ...s.overlay, seconds: n } }))}
        />
        <Text style={type.bodyStrong}>Position</Text>
        <Segmented
          options={[
            { value: 'top', label: 'Top of screen' },
            { value: 'center', label: 'Middle' },
          ]}
          value={settings.overlay.position}
          onChange={(v) => void updateSettings((s) => ({ ...s, overlay: { ...s.overlay, position: v } }))}
        />
        <Text style={[type.small, { marginTop: space(2) }]}>
          Permission: {overlayAllowed ? 'Allowed' : 'Not allowed'}
        </Text>
        {!overlayAllowed ? (
          <Button label="Open overlay setting" variant="secondary" onPress={() => void ScreenWatcher.openOverlaySettings()} />
        ) : (
          <Button
            label="Preview the overlay"
            variant="secondary"
            onPress={() => void showVerdictOverlay(evaluateCard(SAMPLE_CARDS[0].text))}
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
      <Text style={[type.tiny, { textAlign: 'center', marginTop: space(6) }]}>RideOffer Copilot 1.0.0 · Not affiliated with Uber or Lyft</Text>
    </View>
  );
}

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
