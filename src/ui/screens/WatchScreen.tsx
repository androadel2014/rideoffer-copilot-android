import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { getMarket, recordFormat } from '../../engine/market';
import { useStore } from '../../state/createStore';
import { appStore } from '../../state/appStore';
import { settingsStore } from '../../state/settingsStore';
import { refreshOverlayPermission, startWatching, stopWatching } from '../../state/watchController';
import { Button, Card, Chip, Notice, PageHeader, RateHeadline, SectionLabel, Stat } from '../components';
import { fmtClock, fmtMi, fmtMin, fmtMoney, fmtRating, fmtTime, platformLabel } from '../format';
import { useNav, type PermissionKind } from '../navigation';
import { colors, radius, space, type } from '../theme';

export function WatchScreen() {
  const nav = useNav();
  const status = useStore(appStore, (s) => s.watchStatus);
  const stats = useStore(appStore, (s) => s.stats);
  const lastOffer = useStore(appStore, (s) => s.lastOffer);
  const waitStartedAt = useStore(appStore, (s) => s.waitStartedAt);
  const sessionStartedAt = useStore(appStore, (s) => s.sessionStartedAt);
  const overlayAllowed = useStore(appStore, (s) => s.overlayAllowed);
  const stopNotice = useStore(appStore, (s) => s.stopNotice);
  const keyRejected = useStore(appStore, (s) => s.sync.keyRejected);
  const syncEnabled = useStore(settingsStore, (s) => s.settings.sync.enabled);
  const home = useStore(settingsStore, (s) => s.settings.market.home);
  const watching = status === 'watching';
  const now = useTicker(watching);
  const market = getMarket(home);

  // Start Watching flow: step 1 is "Display over other apps" (if not yet allowed),
  // step 2 is Android's screen-capture prompt.
  const onStart = async () => {
    if (!refreshOverlayPermission()) {
      nav.push({ name: 'permission', kind: 'overlay_needed' });
      return;
    }
    await begin(nav.push);
  };

  const lf = lastOffer ? recordFormat(lastOffer) : null;

  return (
    <View>
      <PageHeader
        kicker="RideOffer Copilot"
        title={watching ? 'Watching for offers' : 'Ready to drive'}
        right={<StatusPill watching={watching} />}
      />

      {stopNotice && !watching ? (
        <View style={{ marginBottom: space(4) }}>
          <Notice tone="warn" title="Watching stopped" body={stopNotice}>
            <Button
              label="Dismiss"
              variant="ghost"
              size="sm"
              onPress={() => appStore.set({ stopNotice: null })}
              style={{ marginTop: space(2), alignSelf: 'flex-start' }}
            />
          </Notice>
        </View>
      ) : null}

      {watching ? (
        <Card style={styles.liveCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
            <Pulse />
            <Text style={[type.bodyStrong, { flex: 1 }]}>
              Switch to Uber Driver or Lyft Driver. Verdicts appear right on top of each offer card.
            </Text>
          </View>
          <View style={styles.timerRow}>
            <View style={{ flex: 1 }}>
              <Text style={type.label}>{waitStartedAt ? 'Waiting for next offer' : 'On a trip / offer open'}</Text>
              <Text style={styles.timer}>{waitStartedAt ? fmtClock((now - waitStartedAt) / 1000) : '—'}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={type.label}>Session</Text>
              <Text style={[type.number, { fontSize: 22 }]}>{sessionStartedAt ? fmtClock((now - sessionStartedAt) / 1000) : '—'}</Text>
            </View>
          </View>
          <Button label="Stop Watching" sublabel="Ends screen capture" variant="danger" size="lg" onPress={() => void stopWatching()} />
        </Card>
      ) : (
        <Card style={styles.startCard}>
          <Button
            label="Start Watching"
            sublabel="Tap before you go online"
            icon="▶"
            size="hero"
            loading={status === 'requesting'}
            onPress={() => void onStart()}
          />
          <View style={{ marginTop: space(4), gap: space(1) }}>
            <ReadyRow
              ok={overlayAllowed}
              title="Verdict on top of offers"
              okText="Display over other apps is on"
              badText="Needs one permission · tap to set up"
              onPress={overlayAllowed ? undefined : () => nav.push({ name: 'permission', kind: 'overlay_needed' })}
            />
            <ReadyRow
              ok
              title="Screen capture"
              okText="Android asks each time you start"
            />
            <ReadyRow
              ok
              title={`Market: ${market.name}`}
              okText={`${market.currency} · ${market.unit === 'km' ? 'kilometres' : 'miles'} · change in Settings`}
              onPress={() => nav.setTab('settings')}
            />
          </View>
        </Card>
      )}

      {syncEnabled && keyRejected ? (
        <View style={{ marginTop: space(4) }}>
          <Notice tone="bad" title="Sync key rejected" body="The server refused your personal key. Records stay safely queued on this phone. Fix the key in Settings → Sync." />
        </View>
      ) : null}

      <SectionLabel>{watching ? 'This session' : 'Last session'}</SectionLabel>
      <Card>
        <View style={{ flexDirection: 'row', gap: space(3) }}>
          <Stat label="Offers" value={String(stats.offers)} />
          <Stat label="Great" value={String(stats.great)} tone={colors.great} />
          <Stat label="OK" value={String(stats.ok)} tone={colors.ok} />
          <Stat label="Bad" value={String(stats.bad)} tone={colors.bad} />
        </View>
        {stats.unreadable > 0 ? (
          <Text style={[type.tiny, { marginTop: space(3) }]}>{stats.unreadable} card(s) couldn't be read and were marked CHECK.</Text>
        ) : null}
      </Card>

      <SectionLabel>Latest offer</SectionLabel>
      {lastOffer && lf ? (
        <Pressable
          onPress={() => lastOffer.id && nav.push({ name: 'offer', id: lastOffer.id })}
          accessibilityRole="button"
          accessibilityLabel="Open latest offer details"
          style={({ pressed }) => [pressed && { opacity: 0.88 }]}
        >
          <Card tone={lastOffer.verdict ?? 'CHECK'}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space(4) }}>
              <Text style={[type.small, { flex: 1 }]}>
                {platformLabel(lastOffer.platform)}
                {lastOffer.offerType ? ` · ${lastOffer.offerType}` : ''} · {fmtTime(lastOffer.ts)}
              </Text>
              <Text style={[type.h3, { fontVariant: ['tabular-nums'] }]}>{fmtMoney(lastOffer.total ?? lastOffer.fare, lf)}</Text>
            </View>
            <RateHeadline
              verdict={lastOffer.verdict}
              netPerHour={lastOffer.netPerHour}
              netPerMile={lastOffer.netPerMile}
              reason={lastOffer.reason}
              fmt={lf}
            />
            <View style={styles.chipRow}>
              {lastOffer.totalMi != null ? <Chip label={`${fmtMi(lastOffer.totalMi, lf)} total`} /> : null}
              {lastOffer.totalMin != null ? <Chip label={`${fmtMin(lastOffer.totalMin)} total`} /> : null}
              {lastOffer.riderRating != null ? <Chip icon="★" tone={colors.star} label={fmtRating(lastOffer.riderRating, lf)} /> : null}
            </View>
            {lastOffer.dropoffArea ? (
              <Text style={[type.small, { marginTop: space(3) }]} numberOfLines={1}>
                To {lastOffer.dropoffArea}
              </Text>
            ) : null}
            <Text style={[styles.link, { marginTop: space(3) }]}>View all details ›</Text>
          </Card>
        </Pressable>
      ) : (
        <Card>
          <Text style={type.bodyStrong}>No offers yet</Text>
          <Text style={[type.small, { marginTop: space(1) }]}>
            {watching
              ? 'Keep Uber Driver or Lyft Driver open. When an offer card appears, its verdict shows up on top of it and here.'
              : 'Tap Start Watching, allow the overlay and screen capture, then go online in Uber Driver or Lyft Driver.'}
          </Text>
        </Card>
      )}

      {!watching ? (
        <>
          <SectionLabel>How it works</SectionLabel>
          <Card style={{ gap: space(5) }}>
            <HowStep n={1} title="Start Watching here" body='Allow "Display over other apps" once, then pick "Entire screen" when Android asks to share.' />
            <HowStep n={2} title="Go online in Uber or Lyft" body="Drive as usual. RideOffer Copilot reads offers quietly on your phone." />
            <HowStep n={3} title="Glance at the verdict" body="GREAT / OK / BAD with net per hour and per mile floats on the offer card for a few seconds." />
          </Card>
        </>
      ) : null}
    </View>
  );
}

const PERMISSION_FOR: Record<string, PermissionKind> = {
  capture_denied: 'capture_denied',
  unsupported: 'unsupported',
  error: 'capture_error',
};

export async function begin(push: ReturnType<typeof useNav>['push']): Promise<boolean> {
  const r = await startWatching();
  if (r.ok) return true;
  if (r.reason === 'busy' || r.reason === 'superseded') return false;
  push({ name: 'permission', kind: PERMISSION_FOR[r.kind] ?? 'capture_error', reason: r.reason });
  return false;
}

function ReadyRow({ ok, title, okText, badText, onPress }: { ok: boolean; title: string; okText: string; badText?: string; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.readyRow, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.readyDot, { backgroundColor: ok ? colors.greatSoft : colors.okSoft, borderColor: ok ? colors.greatLine : colors.okLine }]}>
        <Text style={{ color: ok ? colors.great : colors.ok, fontWeight: '900', fontSize: 13 }}>{ok ? '✓' : '!'}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[type.bodyStrong, { fontSize: 15 }]}>{title}</Text>
        <Text style={[type.tiny, { marginTop: 2, color: ok ? colors.textTertiary : colors.ok }]}>{ok ? okText : badText ?? okText}</Text>
      </View>
      {onPress ? <Text style={{ color: colors.textTertiary, fontSize: 22 }}>›</Text> : null}
    </Pressable>
  );
}

function HowStep({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space(4) }}>
      <View style={styles.stepNum}>
        <Text style={{ color: colors.accent, fontWeight: '900', fontSize: 15 }}>{n}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={type.bodyStrong}>{title}</Text>
        <Text style={[type.small, { marginTop: 2 }]}>{body}</Text>
      </View>
    </View>
  );
}

function StatusPill({ watching }: { watching: boolean }) {
  return (
    <View
      style={[
        styles.pill,
        { borderColor: watching ? colors.greatLine : colors.borderHi, backgroundColor: watching ? colors.greatSoft : colors.surface },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: watching ? colors.great : colors.textTertiary }]} />
      <Text style={{ color: watching ? colors.great : colors.textSecondary, fontWeight: '800', fontSize: 12.5, letterSpacing: 0.8 }}>
        {watching ? 'LIVE' : 'OFF'}
      </Text>
    </View>
  );
}

function Pulse() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={{
          position: 'absolute',
          width: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: colors.great,
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.45] }),
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.3] }) }],
        }}
      />
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.great }} />
    </View>
  );
}

function useTicker(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  liveCard: { borderColor: colors.greatLine, gap: space(5), backgroundColor: colors.surface },
  startCard: { padding: space(4), backgroundColor: colors.surface },
  timerRow: { flexDirection: 'row', alignItems: 'flex-end' },
  timer: { color: colors.text, fontSize: 46, fontWeight: '900', fontVariant: ['tabular-nums'], letterSpacing: -1.5 },
  readyRow: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(2), paddingHorizontal: space(1), minHeight: 52 },
  readyDot: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2), marginTop: space(4) },
  stepNum: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accentLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  link: { color: colors.accent, fontWeight: '800', fontSize: 15 },
});
