import React, { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { DEFAULT_ZONES } from '../../config/defaults';
import { matchZone } from '../../engine/zones';
import type { Zone, ZoneClass } from '../../engine/types';
import { useStore } from '../../state/createStore';
import { saveZones, settingsStore } from '../../state/settingsStore';
import { Button, Card, Notice, Screen, SectionLabel, Segmented, TextField, TopBar } from '../components';
import { useNav } from '../navigation';
import { colors, radius, space, type, zoneColor } from '../theme';

const CLASS_LABEL: Record<ZoneClass, string> = { hot: 'Hot', neutral: 'Neutral', dead: 'Dead' };
const NEXT: Record<ZoneClass, ZoneClass> = { hot: 'neutral', neutral: 'dead', dead: 'hot' };

export function ZonesScreen() {
  const nav = useNav();
  const zones = useStore(settingsStore, (s) => s.zones);
  const [keyword, setKeyword] = useState('');
  const [cls, setCls] = useState<ZoneClass>('dead');
  const [filter, setFilter] = useState<ZoneClass>('hot');
  const [testText, setTestText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const k = keyword.trim();
    if (k.length < 2) return setError('Type at least 2 letters.');
    if (zones.some((z) => z.keyword.toLowerCase() === k.toLowerCase())) return setError(`"${k}" is already in the list.`);
    setError(null);
    const z: Zone = { id: `${cls}:${k.toLowerCase()}:${Date.now()}`, keyword: k, zoneClass: cls };
    void saveZones([...zones, z]);
    setKeyword('');
    setFilter(cls);
  };

  const shown = zones.filter((z) => z.zoneClass === filter);
  const test = testText.trim() ? matchZone(testText, zones) : null;

  return (
    <Screen>
      <TopBar title="Zones" onBack={nav.pop} />
      <Text style={type.body}>
        Dropoff text is matched against these words (whole words, any case). The longest match wins. A dead-zone
        dropoff adds the return-trip penalty to the grade.
      </Text>

      <SectionLabel>Add a zone</SectionLabel>
      <Card style={{ gap: space(2) }}>
        <TextField label="Word or place name" value={keyword} onChangeText={setKeyword} placeholder="e.g. Gainesville" autoCapitalize="words" />
        <Segmented
          options={[
            { value: 'hot', label: 'Hot' },
            { value: 'neutral', label: 'Neutral' },
            { value: 'dead', label: 'Dead' },
          ]}
          value={cls}
          onChange={setCls}
        />
        {error ? <Text style={[type.small, { color: colors.ok }]}>{error}</Text> : null}
        <Button label="Add zone" onPress={add} style={{ marginTop: space(2) }} />
      </Card>

      <SectionLabel>Test a dropoff</SectionLabel>
      <Card>
        <TextField label="Dropoff text" value={testText} onChangeText={setTestText} placeholder="e.g. Main St, Warrenton, VA" autoCapitalize="words" />
        {test ? (
          <Text style={[type.bodyStrong, { color: zoneColor(test.zoneClass), marginTop: space(2) }]}>
            {CLASS_LABEL[test.zoneClass]} zone{test.keyword ? ` (matched "${test.keyword}")` : ' (no match: neutral)'}
          </Text>
        ) : null}
      </Card>

      <SectionLabel>Your zones</SectionLabel>
      <Segmented
        options={(['hot', 'neutral', 'dead'] as ZoneClass[]).map((c) => ({
          value: c,
          label: `${CLASS_LABEL[c]} (${zones.filter((z) => z.zoneClass === c).length})`,
        }))}
        value={filter}
        onChange={setFilter}
      />
      <View style={{ marginTop: space(3), gap: space(2) }}>
        {shown.length === 0 ? (
          <Notice title={`No ${CLASS_LABEL[filter].toLowerCase()} zones`} body="Add one above. Dropoffs that match nothing are treated as neutral." />
        ) : (
          shown.map((z) => (
            <View
              key={z.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: colors.surface,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                paddingLeft: space(4),
                minHeight: 64,
              }}
            >
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: zoneColor(z.zoneClass), marginRight: space(3) }} />
              <Text style={[type.bodyStrong, { flex: 1 }]} numberOfLines={1}>
                {z.keyword}
              </Text>
              <Pressable
                onPress={() => void saveZones(zones.map((x) => (x.id === z.id ? { ...x, zoneClass: NEXT[x.zoneClass] } : x)))}
                accessibilityRole="button"
                accessibilityLabel={`Change ${z.keyword} to ${CLASS_LABEL[NEXT[z.zoneClass]]}`}
                style={({ pressed }) => [{ minHeight: 64, justifyContent: 'center', paddingHorizontal: space(3) }, pressed && { opacity: 0.6 }]}
              >
                <Text style={{ color: colors.accent, fontWeight: '800', fontSize: 15 }}>Make {CLASS_LABEL[NEXT[z.zoneClass]]}</Text>
              </Pressable>
              <Pressable
                onPress={() => void saveZones(zones.filter((x) => x.id !== z.id))}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${z.keyword}`}
                style={({ pressed }) => [{ minHeight: 64, justifyContent: 'center', paddingHorizontal: space(4) }, pressed && { opacity: 0.6 }]}
              >
                <Text style={{ color: colors.bad, fontWeight: '800', fontSize: 15 }}>Remove</Text>
              </Pressable>
            </View>
          ))
        )}
      </View>

      <Button
        label="Reset to DC-area defaults"
        variant="ghost"
        style={{ marginTop: space(6) }}
        onPress={() =>
          Alert.alert('Reset zones?', 'Your zone list will be replaced with the built-in DC-metro list.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Reset', style: 'destructive', onPress: () => void saveZones(DEFAULT_ZONES) },
          ])
        }
      />
    </Screen>
  );
}
