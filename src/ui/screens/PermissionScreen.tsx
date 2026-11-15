import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import { ScreenWatcher } from '../../../modules/screen-watcher';
import { useStore } from '../../state/createStore';
import { appStore } from '../../state/appStore';
import { refreshOverlayPermission } from '../../state/watchController';
import { Button, Card, Notice, Screen, TopBar } from '../components';
import { useNav, type PermissionKind } from '../navigation';
import { colors, space, type } from '../theme';
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

  useEffect(() => {
    refreshOverlayPermission();
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
        <TopBar title="One more step" onBack={nav.pop} />
        <Hero glyph="❐" title="Allow the verdict to show on top" />
        <Text style={[type.body, { marginTop: space(4), fontSize: 17 }]}>
          To show GREAT / OK / BAD over the Uber or Lyft app, Android needs the "Display over other apps" permission
          for RideOffer Copilot.
        </Text>
        <Card style={{ marginTop: space(5), gap: space(3) }}>
          <Bullet text={'Tap "Open overlay setting" below.'} />
          <Bullet text={'Find RideOffer Copilot and switch on "Allow display over other apps".'} />
          <Bullet text="Come back here with the Back button." />
        </Card>
        <Text style={[type.small, { marginTop: space(4) }]}>
          The overlay can't be tapped. Your touches go straight to the driver app, so it never gets in the way of
          Accept.
        </Text>
        <View style={{ gap: space(3), marginTop: space(6) }}>
          {overlayAllowed ? (
            <>
              <Notice tone="good" title="Overlay allowed" body="You're all set." />
              <Button label="Start Watching" size="lg" loading={status === 'requesting'} onPress={() => void tryStart()} />
            </>
          ) : (
            <Button label="Open overlay setting" size="lg" onPress={() => void ScreenWatcher.openOverlaySettings()} />
          )}
          {!overlayAllowed ? (
            <Button
              label="Watch without overlay"
              sublabel="Offers are graded and saved to History, but nothing pops up"
              variant="secondary"
              loading={status === 'requesting'}
              onPress={() => void tryStart()}
            />
          ) : null}
          <Button label="Not now" variant="ghost" onPress={nav.pop} />
        </View>
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
      <TopBar title={denied ? 'Permission needed' : "Couldn't start"} onBack={nav.pop} />
      <Hero glyph="◉" title={denied ? "Screen capture wasn't allowed" : "Screen capture couldn't start"} tone={denied ? colors.ok : colors.bad} />
      <Text style={[type.body, { marginTop: space(4), fontSize: 17 }]}>
        {denied
          ? 'RideOffer Copilot has to see the offer card to grade it. Nothing is recorded: each screen is read on this phone and discarded immediately.'
          : REASONS[reason ?? ''] ?? 'Something went wrong while starting screen capture.'}
      </Text>
      <Card style={{ marginTop: space(5), gap: space(3) }}>
        <Text style={type.label}>When Android asks</Text>
        <Bullet text={'Choose "Entire screen" (not "A single app").'} />
        <Bullet text={'Tap "Start" or "Start now".'} />
        <Bullet text="Then switch to Uber Driver or Lyft Driver." />
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
    <View style={{ alignItems: 'flex-start', marginTop: space(2) }}>
      <View
        style={{
          width: 84,
          height: 84,
          borderRadius: 42,
          borderWidth: 2,
          borderColor: tone,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: space(5),
        }}
      >
        <Text style={{ color: tone, fontSize: 38, fontWeight: '900' }}>{glyph}</Text>
      </View>
      <Text style={[type.h1, { fontSize: 30, lineHeight: 36 }]}>{title}</Text>
    </View>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space(3) }}>
      <Text style={{ color: colors.accent, fontSize: 18, fontWeight: '900' }}>•</Text>
      <Text style={[type.body, { flex: 1, color: colors.text }]}>{text}</Text>
    </View>
  );
}
