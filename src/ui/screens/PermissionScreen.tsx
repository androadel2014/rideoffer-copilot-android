import React, { useEffect } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { ScreenWatcher } from '../../../modules/screen-watcher';
import { useStore } from '../../state/createStore';
import { appStore } from '../../state/appStore';
import { refreshOverlayPermission } from '../../state/watchController';
import { Button, Card, IconCircle, Notice, OverlayMock, Screen, StepDots, TopBar } from '../components';
import { useNav, type PermissionKind } from '../navigation';
import { colors, radius, space, type } from '../theme';
import { begin } from './WatchScreen';

const REASONS: Record<string, string> = {
  no_activity: 'The app was in the background when the request was made.',
  launch_failed: "Android couldn't show the screen-capture dialog.",
  timeout: 'Screen capture took too long to start.',
  service_start_failed: "Android didn't allow the capture service to start.",
  foreground_not_allowed: "Android didn't allow the capture service to start.",
  projection_unavailable: 'Android refused the screen-capture session.',
  display_failed: "The capture surface couldn't be created.",
  no_consent: 'The permission result was missing.',
  native_error: 'An unexpected error occurred.',
  stopped: 'Capture was stopped while starting.',
  android_version: 'This feature needs Android 10 or newer.',
  native_unavailable: 'This build does not include the screen-watching module (for example, Expo Go).',
};

export function PermissionScreen({ kind, reason }: { kind: PermissionKind; reason?: string }) {
  const nav = useNav();
  const overlayAllowed = useStore(appStore, (s) => s.overlayAllowed);
  const status = useStore(appStore, (s) => s.watchStatus);

  // Re-check when the driver comes back from Android settings.
  useEffect(() => {
    refreshOverlayPermission();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refreshOverlayPermission();
    });
    return () => sub.remove();
  }, []);

  const tryStart = async () => {
    const ok = await begin((r) => {
      nav.pop();
      nav.push(r);
    });
    if (ok) nav.reset();
  };

  if (kind === 'overlay_needed') {
    return (
      <Screen>
        <TopBar title="Start Watching" subtitle={overlayAllowed ? 'Step 1 of 2 · done' : 'Step 1 of 2'} onBack={nav.pop} />
        <StepDots count={2} index={overlayAllowed ? 1 : 0} />

        <Text style={[type.label, { color: colors.accent, marginTop: space(6) }]}>Permission · Display over other apps</Text>
        <Text style={[type.h1, { marginTop: space(2) }]}>Show the verdict on top of Uber and Lyft</Text>
        <Text style={[type.body, { marginTop: space(3), fontSize: 17, lineHeight: 25 }]}>
          When a ride offer pops up, RideOffer Copilot puts a small card with GREAT, OK or BAD and what the ride really
          pays per hour and per mile right on top of the offer. Android only allows that with the "Display over other
          apps" permission.
        </Text>

        {overlayAllowed ? (
          <View style={{ marginTop: space(6), gap: space(3) }}>
            <Notice tone="good" title="Display over other apps is on" body="Next, Android will ask to share your screen. Pick “Entire screen”, then Start." />
            <Button label="Continue" sublabel="Step 2 of 2 · screen capture" size="lg" loading={status === 'requesting'} onPress={() => void tryStart()} />
            <Button label="Not now" variant="ghost" onPress={nav.pop} />
          </View>
        ) : (
          <View style={{ marginTop: space(6), gap: space(3) }}>
            <Card style={styles.howTo}>
              <Text style={type.label}>In the screen that opens</Text>
              <Bullet n={1} text="Find RideOffer Copilot in the list (it may open directly)." />
              <Bullet n={2} text='Switch on "Allow display over other apps".' />
              <Bullet n={3} text="Press Back to return here. This screen updates by itself." />
            </Card>
            <Button
              label="Open system setting"
              sublabel={'Android › Display over other apps'}
              size="lg"
              onPress={() => void ScreenWatcher.openOverlaySettings()}
            />
            <Button
              label="Watch without the overlay"
              sublabel="Offers are still graded and saved to History"
              variant="secondary"
              loading={status === 'requesting'}
              onPress={() => void tryStart()}
            />
            <Button label="Not now" variant="ghost" onPress={nav.pop} />
          </View>
        )}
        <View style={{ marginTop: space(8), marginBottom: space(2) }}>
          <OverlayMock verdict="GREAT" scale={0.92} />
        </View>

        <Card style={{ marginTop: space(4), gap: space(4) }}>
          <PlainPoint glyph="↗" title="It never blocks your taps" body="Touches pass straight through to the driver app, so Accept always works." />
          <PlainPoint glyph="⏱" title="It goes away by itself" body="It shows for a few seconds, and disappears as soon as the offer card does." />
          <PlainPoint glyph="✓" title="You turn it on once" body="Android remembers it. You can switch it off any time in Android settings." />
        </Card>

      </Screen>
    );
  }

  if (kind === 'unsupported') {
    return (
      <Screen>
        <TopBar title="Not available" onBack={nav.pop} />
        <Hero glyph="!" title="Screen watching isn't available here" tone={colors.ok} />
        <Text style={[type.body, { marginTop: space(4), fontSize: 17 }]}>
          {REASONS[reason ?? ''] ?? 'This device or build cannot capture the screen.'} You can still use History,
          Settings and "Try the grader".
        </Text>
        <Button label="Back" size="lg" onPress={nav.pop} style={{ marginTop: space(8) }} />
      </Screen>
    );
  }

  const denied = kind === 'capture_denied';
  return (
    <Screen>
      <TopBar title="Start Watching" subtitle="Step 2 of 2 · screen capture" onBack={nav.pop} />
      <StepDots count={2} index={1} />
      <View style={{ marginTop: space(6) }}>
        <Hero glyph="◉" title={denied ? "Screen capture wasn't allowed" : "Screen capture couldn't start"} tone={denied ? colors.ok : colors.bad} />
      </View>
      <Text style={[type.body, { marginTop: space(4), fontSize: 17, lineHeight: 25 }]}>
        {denied
          ? 'RideOffer Copilot has to see the offer card to grade it. Nothing is recorded: each screen is read on this phone and discarded immediately.'
          : REASONS[reason ?? ''] ?? 'Something went wrong while starting screen capture.'}
      </Text>
      <Card style={[styles.howTo, { marginTop: space(5) }]}>
        <Text style={type.label}>When Android asks</Text>
        <Bullet n={1} text={'Choose "Entire screen" (not "A single app").'} />
        <Bullet n={2} text={'Tap "Start" or "Start now".'} />
        <Bullet n={3} text="Then switch to Uber Driver or Lyft Driver." />
      </Card>
      <View style={{ gap: space(3), marginTop: space(6) }}>
        <Button label="Try again" size="lg" loading={status === 'requesting'} onPress={() => void tryStart()} />
        {!denied ? <Button label="Open app settings" variant="secondary" onPress={() => void ScreenWatcher.openAppSettings()} /> : null}
        <Button label="Not now" variant="ghost" onPress={nav.pop} />
      </View>
    </Screen>
  );
}

function Hero({ glyph, title, tone = colors.accent }: { glyph: string; title: string; tone?: string }) {
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <View style={{ marginBottom: space(5) }}>
        <IconCircle glyph={glyph} tone={tone} size={72} />
      </View>
      <Text style={[type.h1, { fontSize: 28, lineHeight: 34 }]}>{title}</Text>
    </View>
  );
}

function PlainPoint({ glyph, title, body }: { glyph: string; title: string; body: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space(4), alignItems: 'flex-start' }}>
      <IconCircle glyph={glyph} size={36} />
      <View style={{ flex: 1 }}>
        <Text style={type.bodyStrong}>{title}</Text>
        <Text style={[type.small, { marginTop: 2 }]}>{body}</Text>
      </View>
    </View>
  );
}

function Bullet({ n, text }: { n: number; text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space(3), alignItems: 'flex-start' }}>
      <View style={styles.bulletNum}>
        <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '900' }}>{n}</Text>
      </View>
      <Text style={[type.body, { flex: 1, color: colors.text }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  howTo: { gap: space(3), backgroundColor: colors.surface },
  bulletNum: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
});
