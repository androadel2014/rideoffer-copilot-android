import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../state/createStore';
import { appStore } from '../state/appStore';
import { useNav, type Tab } from './navigation';
import { colors, space } from './theme';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'watch', label: 'Watch' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' },
];

export const TAB_BAR_HEIGHT = 72;

export function TabBar() {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const watching = useStore(appStore, (s) => s.watchStatus === 'watching');
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space(2)) }]} accessibilityRole="tablist">
      {TABS.map((t) => {
        const active = nav.tab === t.id;
        return (
          <Pressable
            key={t.id}
            onPress={() => nav.setTab(t.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t.label}
            style={({ pressed }) => [styles.tab, pressed && { opacity: 0.7 }]}
          >
            <View style={[styles.indicator, active && { backgroundColor: colors.accent }]} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {t.id === 'watch' && watching ? <View style={styles.live} /> : null}
              <Text style={[styles.label, active && { color: colors.text }]}>{t.label}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.bgElevated,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderHi,
  },
  tab: { flex: 1, minHeight: TAB_BAR_HEIGHT - 8, alignItems: 'center', justifyContent: 'center', gap: 8 },
  indicator: { width: 28, height: 4, borderRadius: 2, backgroundColor: 'transparent' },
  label: { color: colors.textTertiary, fontSize: 16, fontWeight: '800' },
  live: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.great },
});
