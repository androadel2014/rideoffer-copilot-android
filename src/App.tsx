import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { configureSync } from './sync/syncService';
import { useStore } from './state/createStore';
import { appStore } from './state/appStore';
import { loadSettings, settingsStore } from './state/settingsStore';
import { initWatchController } from './state/watchController';
import { Screen } from './ui/components';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { NavigationProvider, useNav } from './ui/navigation';
import { GraderScreen } from './ui/screens/GraderScreen';
import { HistoryScreen } from './ui/screens/HistoryScreen';
import { OfferDetailScreen } from './ui/screens/OfferDetailScreen';
import { OnboardingScreen } from './ui/screens/OnboardingScreen';
import { PermissionScreen } from './ui/screens/PermissionScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { WatchScreen } from './ui/screens/WatchScreen';
import { ZonesScreen } from './ui/screens/ZonesScreen';
import { TabBar } from './ui/TabBar';
import { colors } from './ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        await loadSettings();
      } catch {
        /* defaults stay in place */
      }
      initWatchController();
      configureSync(); // no-op (no timers, no requests) while sync is off
      setReady(true);
      SplashScreen.hideAsync().catch(() => undefined);
    })();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ErrorBoundary>{ready ? <NavigationProvider><Root /></NavigationProvider> : null}</ErrorBoundary>
      </View>
    </SafeAreaProvider>
  );
}

function Root() {
  const nav = useNav();
  const onboardingDone = useStore(settingsStore, (s) => s.onboardingDone);
  // Re-render on status changes so pushed screens reflect live state.
  useStore(appStore, (s) => s.watchStatus);

  if (!onboardingDone) return <OnboardingScreen />;

  const top = nav.stack[nav.stack.length - 1];
  switch (top.name) {
    case 'offer':
      return <OfferDetailScreen id={top.id} />;
    case 'zones':
      return <ZonesScreen />;
    case 'grader':
      return <GraderScreen />;
    case 'permission':
      return <PermissionScreen kind={top.kind} reason={top.reason} />;
    case 'tabs':
    default:
      return (
        <View style={{ flex: 1 }}>
          <Screen padBottom={0}>
            {nav.tab === 'watch' ? <WatchScreen /> : nav.tab === 'history' ? <HistoryScreen /> : <SettingsScreen />}
          </Screen>
          <TabBar />
        </View>
      );
  }
}

