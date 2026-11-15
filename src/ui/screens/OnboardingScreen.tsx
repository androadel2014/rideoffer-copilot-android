import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ScreenWatcher } from '../../../modules/screen-watcher';
import { useStore } from '../../state/createStore';
import { appStore } from '../../state/appStore';
import { completeOnboarding } from '../../state/settingsStore';
import { refreshOverlayPermission } from '../../state/watchController';
import { Button, Card, Screen } from '../components';
import { colors, radius, space, type } from '../theme';

interface Step {
  kicker: string;
  title: string;
  body: string[];
  art: 'overlay' | 'capture' | 'layers' | 'shield';
}

const STEPS: Step[] = [
  {
    kicker: 'Welcome',
    title: 'Know if a ride is worth it, at a glance',
    body: [
      'RideOffer Copilot reads Uber and Lyft ride offers on your screen and grades each one in about a second.',
      'Two big numbers pop up on top of the driver app: what the ride really pays per hour and per mile after car costs, like "$36/hr, 68¢/mi". A GREAT, OK or BAD verdict and a short reason sit right under them. You never leave Uber or Lyft.',
    ],
    art: 'overlay',
  },
  {
    kicker: 'Permission 1 of 2',
    title: 'Screen capture',
    body: [
      'Each time you tap Start Watching, Android asks if RideOffer Copilot may capture your screen. Choose "Entire screen", then "Start".',
      'Screens are read by text recognition on this phone and thrown away right away. No pictures are saved or sent anywhere.',
      'Android shows a notification while watching. Stop any time from the notification or the app.',
    ],
    art: 'capture',
  },
  {
    kicker: 'Permission 2 of 2',
    title: 'Display over other apps',
    body: [
      'This lets the verdict card appear on top of the Uber or Lyft app for a few seconds.',
      'Your taps pass straight through it, so it never blocks the Accept button. You turn this on once in Android settings.',
    ],
    art: 'layers',
  },
  {
    kicker: 'Private by design',
    title: 'Your data stays on your phone',
    body: [
      'Rider names are never stored. Your offer history lives only on this phone. No ads, no analytics, no tracking.',
      'Sync to a server is off unless you turn it on yourself in Settings.',
      'Drive safely: the verdict is made for a quick glance. The decision is always yours.',
    ],
    art: 'shield',
  },
];

export function OnboardingScreen() {
  const [i, setI] = useState(0);
  const overlayAllowed = useStore(appStore, (s) => s.overlayAllowed);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  return (
    <Screen contentStyle={{ flexGrow: 1 }}>
      <View style={styles.progress}>
        {STEPS.map((_, k) => (
          <View key={k} style={[styles.bar, k <= i && { backgroundColor: colors.accent }]} />
        ))}
      </View>

      <View style={{ flex: 1, justifyContent: 'center', paddingVertical: space(6) }}>
        <Art kind={step.art} />
        <Text style={[type.label, { color: colors.accent, marginTop: space(8) }]}>{step.kicker}</Text>
        <Text style={[type.h1, { marginTop: space(2), fontSize: 30, lineHeight: 36 }]}>{step.title}</Text>
        {step.body.map((p, k) => (
          <Text key={k} style={[type.body, { marginTop: space(3), fontSize: 17, lineHeight: 25 }]}>
            {p}
          </Text>
        ))}
        {step.art === 'layers' ? (
          <View style={{ marginTop: space(5) }}>
            {overlayAllowed ? (
              <Card style={{ borderColor: colors.great }}>
                <Text style={[type.bodyStrong, { color: colors.great }]}>Overlay is allowed. You're set.</Text>
              </Card>
            ) : (
              <Button
                label="Allow overlay now"
                sublabel="Opens Android settings. Turn on RideOffer Copilot, then come back."
                variant="secondary"
                size="lg"
                onPress={async () => {
                  await ScreenWatcher.openOverlaySettings();
                  setTimeout(refreshOverlayPermission, 800);
                }}
              />
            )}
          </View>
        ) : null}
      </View>

      <View style={{ gap: space(3) }}>
        <Button
          label={last ? 'Get started' : 'Next'}
          size="lg"
          onPress={() => (last ? void completeOnboarding() : setI(i + 1))}
        />
        {i > 0 ? <Button label="Back" variant="ghost" onPress={() => setI(i - 1)} /> : null}
      </View>
    </Screen>
  );
}

function Art({ kind }: { kind: Step['art'] }) {
  if (kind === 'overlay') {
    return (
      <View style={styles.phone}>
        <View style={[styles.mockOverlay, { backgroundColor: '#15803D' }]}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.mockLabel}>NET / HOUR</Text>
              <Text style={styles.mockNum}>$36/hr</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.mockLabel}>NET / MILE</Text>
              <Text style={styles.mockNum}>$1.42/mi</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <Text style={styles.mockVerdict}>GREAT</Text>
            <Text style={[styles.mockReason, { flex: 1 }]}>Clears $30/hr and $1.25/mi net</Text>
          </View>
        </View>
        <View style={styles.mockCard}>
          <View style={[styles.mockLine, { width: '40%' }]} />
          <View style={[styles.mockLine, { width: '70%', height: 14 }]} />
          <View style={[styles.mockLine, { width: '55%' }]} />
          <View style={styles.mockAccept} />
        </View>
      </View>
    );
  }
  const glyph = kind === 'capture' ? '◉' : kind === 'layers' ? '❐' : '✓';
  return (
    <View style={styles.artCircle}>
      <Text style={{ color: colors.accent, fontSize: 56, fontWeight: '900' }}>{glyph}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  progress: { flexDirection: 'row', gap: space(2) },
  bar: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.border },
  artCircle: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.borderHi,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phone: {
    alignSelf: 'center',
    width: 260,
    height: 300,
    borderRadius: 34,
    borderWidth: 2,
    borderColor: colors.borderHi,
    backgroundColor: '#0D1118',
    padding: 14,
    justifyContent: 'space-between',
  },
  mockOverlay: { borderRadius: 20, padding: 14 },
  mockLabel: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 1, opacity: 0.85 },
  mockNum: { color: '#fff', fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  mockVerdict: {
    color: '#15803D',
    backgroundColor: '#fff',
    fontSize: 12,
    fontWeight: '900',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  mockReason: { color: '#fff', fontSize: 11, fontWeight: '700' },
  mockCard: { backgroundColor: colors.surfaceHi, borderRadius: radius.md, padding: 12, gap: 8 },
  mockLine: { height: 9, borderRadius: 5, backgroundColor: colors.borderHi },
  mockAccept: { height: 26, borderRadius: 8, backgroundColor: '#2B3446', marginTop: 4 },
});
