import { DEFAULT_SETTINGS, DEFAULT_ZONES, type AppSettings } from '../config/defaults';
import { normalizeSettings } from '../config/validate';
import { getKv, listZones, replaceZones, setKv } from '../db/database';
import type { Zone } from '../engine/types';
import { setSyncPolicyProvider } from '../net/networkGate';
import { createStore } from './createStore';

interface SettingsState {
  loaded: boolean;
  settings: AppSettings;
  zones: Zone[];
  onboardingDone: boolean;
}

export const settingsStore = createStore<SettingsState>({
  loaded: false,
  settings: DEFAULT_SETTINGS,
  zones: DEFAULT_ZONES,
  onboardingDone: false,
});

// The network gate reads the live, in-memory sync switch. Until settings load it is OFF.
setSyncPolicyProvider(() => {
  const s = settingsStore.get().settings.sync;
  return { enabled: s.enabled, baseUrl: s.baseUrl };
});

const SETTINGS_KEY = 'settings.v1';
const ONBOARDING_KEY = 'onboarding.done';

export async function loadSettings(): Promise<void> {
  let settings = DEFAULT_SETTINGS;
  let zones = DEFAULT_ZONES;
  let onboardingDone = false;
  try {
    const raw = await getKv(SETTINGS_KEY);
    settings = normalizeSettings(raw ? JSON.parse(raw) : {});
  } catch {
    settings = normalizeSettings({});
  }
  try {
    const z = await listZones();
    zones = z.length ? z : DEFAULT_ZONES;
  } catch {
    zones = DEFAULT_ZONES;
  }
  try {
    onboardingDone = (await getKv(ONBOARDING_KEY)) === '1';
  } catch {
    onboardingDone = false;
  }
  settingsStore.set({ loaded: true, settings, zones, onboardingDone });
}

export async function updateSettings(mutator: (s: AppSettings) => AppSettings): Promise<AppSettings> {
  const next = normalizeSettings(mutator(settingsStore.get().settings));
  settingsStore.set({ settings: next });
  await setKv(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

export async function saveZones(zones: Zone[]): Promise<void> {
  const clean = zones
    .map((z) => ({ ...z, keyword: z.keyword.trim().slice(0, 60) }))
    .filter((z) => z.keyword.length > 0);
  settingsStore.set({ zones: clean });
  await replaceZones(clean);
}

export async function completeOnboarding(): Promise<void> {
  settingsStore.set({ onboardingDone: true });
  await setKv(ONBOARDING_KEY, '1');
}
