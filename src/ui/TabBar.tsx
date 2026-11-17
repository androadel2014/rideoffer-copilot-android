import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../state/createStore';
import { appStore } from '../state/appStore';
import { useNav, type Tab } from './navigation';
import { colors, radius, space } from './theme';

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
        const tint = active ? colors.text : colors.textTertiary;
        return (
          <Pressable
            key={t.id}
            onPress={() => nav.setTab(t.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t.label}
            style={({ pressed }) => [styles.tab, pressed && { opacity: 0.7 }]}
          >
            <View style={[styles.iconWrap, active && styles.iconActive]}>
              <TabIcon id={t.id} color={active ? colors.accent : tint} />
              {t.id === 'watch' && watching ? <View style={styles.live} /> : null}
            </View>
            <Text style={[styles.label, { color: tint }]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Dependency-free glyphs drawn with views: a target (watch), a list (history), sliders (settings). */
function TabIcon({ id, color }: { id: Tab; color: string }) {
  if (id === 'watch') {
    return (
      <View style={[styles.ring, { borderColor: color }]}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      </View>
    );
  }
  if (id === 'history') {
    return (
      <View style={{ gap: 3 }}>
        {[14, 18, 11].map((w, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: color }} />
            <View style={{ width: w, height: 2.5, borderRadius: 2, backgroundColor: color }} />
          </View>
        ))}
      </View>
    );
  }
  return (
    <View style={{ gap: 5 }}>
      {[6, 13].map((x, i) => (
        <View key={i} style={{ width: 20, height: 2.5, borderRadius: 2, backgroundColor: color }}>
          <View style={{ position: 'absolute', left: x - 3, top: -3, width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.bgElevated,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderHi,
    paddingTop: space(2),
  },
  tab: { flex: 1, minHeight: TAB_BAR_HEIGHT - 12, alignItems: 'center', justifyContent: 'center', gap: 5 },
  iconWrap: { width: 52, height: 30, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  iconActive: { backgroundColor: colors.accentSoft },
  ring: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 12.5, fontWeight: '800', letterSpacing: 0.2 },
  live: { position: 'absolute', top: 3, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.great, borderWidth: 1.5, borderColor: colors.bgElevated },
});
