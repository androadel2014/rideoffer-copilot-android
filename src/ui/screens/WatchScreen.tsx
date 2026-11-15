import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { ScreenWatcher } from '../../../modules/screen-watcher';
import { useStore } from '../../state/createStore';
import { appStore } from '../../state/appStore';
import { settingsStore } from '../../state/settingsStore';
import { refreshOverlayPermission, startWatching, stopWatching } from '../../state/watchController';
import { Button, Card, Notice, RateHeadline, SectionLabel, Stat } from '../components';
import { fmtClock, fmtMoney, fmtTime, platformLabel } from '../format';
import { useNav, type PermissionKind } from '../navigation';
import { colors, radius, space, type, verdictColor } from '../theme';

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
  const watching = status === 'watching';
  const now = useTicker(watching);

  const onStart = async () => {
    if (!refreshOverlayPermission()) {
      nav.push({ name: 'permission', kind: 'overlay_needed' });
      return;
    }
    await begin(nav.push);
  };

  return (
    <View>
      <View style={styles.header}>
        <View>
          <Text style={type.label}>RideOffer Copilot</Text>
          <Text style={[type.h1, { marginTop: 2 }]}>{watching ? 'Watching for offers' : 'Ready when you are'}</Text>
        </View>
        <StatusPill watching={watching} />
      </View>

      {stopNotice && !watching ? (
        <View style={{ marginBottom: space(4) }}>
          <Notice tone="warn" title="Watching stopped" body={stopNotice}>
            <Button label="Dismiss" variant="ghost" onPress={() => appStore.set({ stopNotice: null })} style={{ marginTop: space(2), alignSelf: 'flex-start' }} />
          </Notice>
        </View>
      ) : null}

      {watching ? (
        <Card style={styles.liveCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
            <Pulse />
            <Text style={[type.bodyStrong, { flex: 1 }]}>Switch to Uber Driver or Lyft Driver now. Verdicts will pop up on top.</Text>
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
        </Card>
      ) : null}

      <View style={{ marginTop: space(4) }}>
        {watching ? (
          <Button label="Stop Watching" sublabel="Ends screen capture" variant="danger" size="lg" onPress={() => void stopWatching()} />
        ) : (
          <Button
            label="Start Watching"
            sublabel="Tap before you go online"
            size="hero"
            loading={status === 'requesting'}
            onPress={() => void onStart()}
          />
        )}
      </View>

      {!overlayAllowed ? (
        <View style={{ marginTop: space(4) }}>
          <Notice
            tone="warn"
            title="Overlay is off"
            body="Verdicts can't appear on top of Uber or Lyft until you allow 'Display over other apps'. Offers are still graded and saved."
          >
            <Button
              label="Allow overlay"
              variant="secondary"
              onPress={async () => {
                await ScreenWatcher.openOverlaySettings();
              }}
              style={{ marginTop: space(3) }}
            />
          </Notice>
        </View>
      ) : null}

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
      {lastOffer ? (
        <Pressable
          onPress={() => lastOffer.id && nav.push({ name: 'offer', id: lastOffer.id })}
          accessibilityRole="button"
          accessibilityLabel="Open latest offer details"
          style={({ pressed }) => [pressed && { opacity: 0.85 }]}
        >
          <Card style={{ borderColor: verdictColor(lastOffer.verdict).fg }}>
            <Text style={[type.small, { marginBottom: space(3) }]}>
              {platformLabel(lastOffer.platform)} · {fmtTime(lastOffer.ts)} · {fmtMoney(lastOffer.total ?? lastOffer.fare)}
            </Text>
            <RateHeadline
              verdict={lastOffer.verdict}
              netPerHour={lastOffer.netPerHour}
              netPerMile={lastOffer.netPerMile}
              reason={lastOffer.reason}
              detail={lastOffer.dropoffArea ? `To ${lastOffer.dropoffArea}` : undefined}
            />
            <Text style={[styles.link, { marginTop: space(3) }]}>View details</Text>
          </Card>
        </Pressable>
      ) : (
        <Card>
          <Text style={type.bodyStrong}>No offers yet</Text>
          <Text style={[type.small, { marginTop: space(1) }]}>
            {watching
              ? 'Keep Uber Driver or Lyft Driver open. When an offer card appears, its verdict shows up here and on top of the driver app.'
              : 'Tap Start Watching, allow screen capture, then go online in Uber Driver or Lyft Driver.'}
          </Text>
        </Card>
      )}

      {!watching ? (
        <>
          <SectionLabel>How it works</SectionLabel>
          <Card style={{ gap: space(4) }}>
            <HowStep n={1} title="Start Watching here" body='Android asks to share your screen. Pick "Entire screen".' />
            <HowStep n={2} title="Go online in Uber or Lyft" body="Drive as usual. RideOffer Copilot watches quietly in the background." />
            <HowStep n={3} title="Glance at the verdict" body="When an offer appears, GREAT / OK / BAD shows on top for a few seconds." />
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

function HowStep({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space(4) }}>
      <View style={styles.stepNum}>
        <Text style={{ color: colors.accent, fontWeight: '900', fontSize: 16 }}>{n}</Text>
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
    <View style={[styles.pill, { borderColor: watching ? colors.great : colors.borderHi, backgroundColor: watching ? colors.greatSoft : colors.surface }]}>
      <View style={[styles.dot, { backgroundColor: watching ? colors.great : colors.textTertiary }]} />
      <Text style={{ color: watching ? colors.great : colors.textSecondary, fontWeight: '800', fontSize: 13 }}>
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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: space(5) },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  liveCard: { borderColor: colors.great, gap: space(4) },
  timerRow: { flexDirection: 'row', alignItems: 'flex-end' },
  timer: { color: colors.text, fontSize: 44, fontWeight: '900', fontVariant: ['tabular-nums'], letterSpacing: -1 },
  stepNum: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  link: { color: colors.accent, fontWeight: '800', fontSize: 15 },
});
