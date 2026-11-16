import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { ScreenWatcher } from '../../../modules/screen-watcher';
import { useStore } from '../../state/createStore';
import { appStore } from '../../state/appStore';
import { completeOnboarding } from '../../state/settingsStore';
import { refreshOverlayPermission } from '../../state/watchController';
import { Button, IconCircle, Notice, OverlayMock, Screen, StepDots } from '../components';
import { colors, space, type } from '../theme';

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
      'A card floats right on top of the offer: what the ride really pays per hour and per mile (or km) after car costs, a GREAT, OK or BAD verdict, the total distance and the rider\'s rating. You never leave Uber or Lyft.',
    ],
    art: 'overlay',
  },
  {
    kicker: 'Permission 1 of 2',
    title: 'Display over other apps',
    body: [
      'This lets the verdict appear on top of the Uber or Lyft offer card for a few seconds.',
      'Your taps pass straight through it, so it never blocks the Accept button. You turn this on once in Android settings.',
    ],
    art: 'layers',
  },
  {
    kicker: 'Permission 2 of 2',
    title: 'Screen capture',
    body: [
      'Each time you tap Start Watching, Android asks if RideOffer Copilot may capture your screen. Choose "Entire screen", then "Start".',
      'Screens are read by text recognition on this phone and thrown away right away. No pictures are saved or sent anywhere.',
    ],
    art: 'capture',
  },
  {
    kicker: 'Private by design',
    title: 'Your data stays on your phone',
    body: [
      'Rider names are never stored, only the star rating. Your offer history lives only on this phone. No ads, no analytics, no tracking.',
      'Driving outside the US? Pick your market in Settings: currency, km or miles, and your own GREAT/BAD thresholds.',
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
      <StepDots count={STEPS.length} index={i} />

      <View style={{ flex: 1, justifyContent: 'center', paddingVertical: space(6) }}>
        <Art kind={step.art} />
        <Text style={[type.label, { color: colors.accent, marginTop: space(8) }]}>{step.kicker}</Text>
        <Text style={[type.h1, { marginTop: space(2), lineHeight: 36 }]}>{step.title}</Text>
        {step.body.map((p, k) => (
          <Text key={k} style={[type.body, { marginTop: space(3), fontSize: 17, lineHeight: 25 }]}>
            {p}
          </Text>
        ))}
        {step.art === 'layers' ? (
          <View style={{ marginTop: space(5) }}>
            {overlayAllowed ? (
              <Notice tone="good" title="Display over other apps is on. You're set." />
            ) : (
              <Button
                label="Open system setting"
                sublabel="Turn on RideOffer Copilot, then press Back"
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
        <Button label={last ? 'Get started' : 'Next'} size="lg" onPress={() => (last ? void completeOnboarding() : setI(i + 1))} />
        {i > 0 ? <Button label="Back" variant="ghost" onPress={() => setI(i - 1)} /> : null}
      </View>
    </Screen>
  );
}

function Art({ kind }: { kind: Step['art'] }) {
  if (kind === 'overlay' || kind === 'layers') return <OverlayMock verdict="GREAT" scale={kind === 'overlay' ? 1 : 0.8} />;
  const glyph = kind === 'capture' ? '◉' : '✓';
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <IconCircle glyph={glyph} size={104} />
    </View>
  );
}
