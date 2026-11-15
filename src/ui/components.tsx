import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatPerHour, formatPerMile } from '../engine/grading';
import type { Verdict } from '../engine/types';
import { colors, radius, space, type, verdictColor } from './theme';

// ---------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------

export function Screen({
  children,
  scroll = true,
  padBottom = 0,
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padBottom?: number;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const pad = { paddingTop: insets.top + space(3), paddingBottom: insets.bottom + space(6) + padBottom };
  if (!scroll) return <View style={[styles.screen, pad, contentStyle]}>{children}</View>;
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.scrollContent, pad, contentStyle]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function TopBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <View style={styles.topBar}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
          style={({ pressed }) => [styles.backBtn, pressed && { backgroundColor: colors.surfacePressed }]}
        >
          <Text style={styles.backText}>‹  Back</Text>
        </Pressable>
      ) : null}
      <Text style={[type.h1, { flex: 1 }]} numberOfLines={1}>
        {title}
      </Text>
      {right}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionLabel({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ marginTop: space(6), marginBottom: space(2), paddingHorizontal: space(1) }, style]}>
      <Text style={type.label}>{children}</Text>
    </View>
  );
}

export function Divider() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: space(3) }} />;
}

// ---------------------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';

export function Button({
  label,
  sublabel,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  style,
}: {
  label: string;
  sublabel?: string;
  onPress: () => void;
  variant?: Variant;
  size?: 'md' | 'lg' | 'hero';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const v = VARIANTS[variant];
  const h = size === 'hero' ? 112 : size === 'lg' ? 64 : 54;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={sublabel ? `${label}. ${sublabel}` : label}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={({ pressed }) => [
        styles.btn,
        { minHeight: h, backgroundColor: pressed ? v.pressed : v.bg, borderColor: v.border },
        size === 'hero' && { borderRadius: radius.xl },
        (disabled || loading) && { opacity: 0.5 },
        pressed && { transform: [{ scale: 0.985 }] },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <>
          <Text style={[styles.btnLabel, { color: v.fg, fontSize: size === 'hero' ? 30 : size === 'lg' ? 19 : 17 }]}>
            {label}
          </Text>
          {sublabel ? <Text style={[styles.btnSub, { color: v.fg }]}>{sublabel}</Text> : null}
        </>
      )}
    </Pressable>
  );
}

const VARIANTS: Record<Variant, { bg: string; pressed: string; fg: string; border: string }> = {
  primary: { bg: colors.accent, pressed: colors.accentPressed, fg: colors.white, border: colors.accent },
  success: { bg: colors.great, pressed: '#1BA74F', fg: '#04150A', border: colors.great },
  secondary: { bg: colors.surfaceHi, pressed: colors.surfacePressed, fg: colors.text, border: colors.borderHi },
  danger: { bg: 'transparent', pressed: colors.badSoft, fg: colors.bad, border: colors.bad },
  ghost: { bg: 'transparent', pressed: colors.surfacePressed, fg: colors.accent, border: 'transparent' },
};

// ---------------------------------------------------------------------------------------
// Data display
// ---------------------------------------------------------------------------------------

export function VerdictBadge({ verdict, size = 'md' }: { verdict: Verdict | null; size?: 'sm' | 'md' | 'lg' }) {
  const c = verdictColor(verdict);
  const fs = size === 'lg' ? 22 : size === 'sm' ? 12 : 14;
  return (
    <View style={[styles.badge, { backgroundColor: c.soft, borderColor: c.fg, paddingHorizontal: fs * 0.8 }]}>
      <Text style={{ color: c.fg, fontWeight: '900', fontSize: fs, letterSpacing: 1 }}>{verdict ?? 'CHECK'}</Text>
    </View>
  );
}

/**
 * The in-app twin of the overlay: NET $/hr and NET ¢/mi as the two big numbers,
 * with the verdict pill and the reason underneath.
 */
export function RateHeadline({
  verdict,
  netPerHour,
  netPerMile,
  reason,
  detail,
  compact,
}: {
  verdict: Verdict | null;
  netPerHour: number | null;
  netPerMile: number | null;
  reason?: string;
  detail?: string;
  compact?: boolean;
}) {
  const c = verdictColor(verdict);
  const size = compact ? 34 : 46;
  return (
    <View>
      <View style={{ flexDirection: 'row', gap: space(4) }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={type.label}>Net / hour</Text>
          <Text style={[styles.headlineNum, { fontSize: size, color: c.fg }]} numberOfLines={1} adjustsFontSizeToFit>
            {formatPerHour(netPerHour)}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={type.label}>Net / mile</Text>
          <Text style={[styles.headlineNum, { fontSize: size, color: c.fg }]} numberOfLines={1} adjustsFontSizeToFit>
            {formatPerMile(netPerMile)}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), marginTop: space(3) }}>
        <VerdictBadge verdict={verdict} size={compact ? 'sm' : 'md'} />
        {reason ? (
          <Text style={[type.bodyStrong, { flex: 1 }]} numberOfLines={2}>
            {reason}
          </Text>
        ) : null}
      </View>
      {detail ? <Text style={[type.small, { marginTop: space(2) }]}>{detail}</Text> : null}
    </View>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={type.label}>{label}</Text>
      <Text style={[type.number, tone ? { color: tone } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {hint ? <Text style={type.tiny}>{hint}</Text> : null}
    </View>
  );
}

export function KeyValue({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <View style={styles.kv}>
      <Text style={[type.small, { flex: 1 }]}>{k}</Text>
      <Text
        style={[type.bodyStrong, { flexShrink: 1, textAlign: 'right' }, mono && { fontVariant: ['tabular-nums'] }]}
        selectable
      >
        {v}
      </Text>
    </View>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <View style={styles.emptyDot} />
      </View>
      <Text style={[type.h2, { textAlign: 'center' }]}>{title}</Text>
      <Text style={[type.body, { textAlign: 'center', marginTop: space(2) }]}>{body}</Text>
      {action ? <View style={{ marginTop: space(5), alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

export function Notice({ tone = 'info', title, body, children }: { tone?: 'info' | 'warn' | 'bad' | 'good'; title: string; body?: string; children?: React.ReactNode }) {
  const c = tone === 'warn' ? colors.ok : tone === 'bad' ? colors.bad : tone === 'good' ? colors.great : colors.accent;
  return (
    <View style={[styles.notice, { borderColor: c }]}>
      <Text style={[type.bodyStrong, { color: c }]}>{title}</Text>
      {body ? <Text style={[type.small, { marginTop: space(1) }]}>{body}</Text> : null}
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segment} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.segmentItem, active && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, active && { color: colors.text }]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Numeric field that only commits valid numbers (on blur / submit). */
export function NumberField({
  label,
  help,
  value,
  onCommit,
  prefix,
  suffix,
  decimals = 2,
}: {
  label: string;
  help?: string;
  value: number;
  onCommit: (n: number) => void;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}) {
  const fmt = (n: number) => (decimals === 0 ? String(Math.round(n)) : String(+n.toFixed(decimals)));
  const [text, setText] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);
  const commit = () => {
    const n = parseFloat(text.replace(',', '.'));
    if (Number.isFinite(n)) onCommit(n);
    else setText(fmt(value));
  };
  return (
    <View style={styles.field}>
      <View style={{ flex: 1, paddingRight: space(3) }}>
        <Text style={type.bodyStrong}>{label}</Text>
        {help ? <Text style={[type.small, { marginTop: 2 }]}>{help}</Text> : null}
      </View>
      <View style={[styles.numberBox, focused && { borderColor: colors.accent }]}>
        {prefix ? <Text style={styles.affix}>{prefix}</Text> : null}
        <TextInput
          value={text}
          onChangeText={setText}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commit();
          }}
          onSubmitEditing={commit}
          keyboardType="decimal-pad"
          returnKeyType="done"
          selectTextOnFocus
          accessibilityLabel={label}
          style={styles.numberInput}
          placeholderTextColor={colors.textTertiary}
        />
        {suffix ? <Text style={styles.affix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

export function TextField({
  label,
  help,
  value,
  onChangeText,
  onBlur,
  placeholder,
  secure,
  autoCapitalize = 'none',
}: {
  label: string;
  help?: string;
  value: string;
  onChangeText: (s: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  secure?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ paddingVertical: space(2) }}>
      <Text style={type.bodyStrong}>{label}</Text>
      {help ? <Text style={[type.small, { marginTop: 2 }]}>{help}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        secureTextEntry={secure}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        accessibilityLabel={label}
        style={[styles.textInput, focused && { borderColor: colors.accent }]}
      />
    </View>
  );
}

export function ToggleRow({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      style={styles.field}
    >
      <View style={{ flex: 1, paddingRight: space(3) }}>
        <Text style={type.bodyStrong}>{label}</Text>
        {help ? <Text style={[type.small, { marginTop: 2 }]}>{help}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.borderHi, true: colors.accent }}
        thumbColor={colors.white}
      />
    </Pressable>
  );
}

export function ListRow({
  title,
  subtitle,
  right,
  onPress,
  actionLabel,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  actionLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={actionLabel ?? title}
      style={({ pressed }) => [styles.listRow, pressed && { backgroundColor: colors.surfacePressed }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={type.bodyStrong}>{title}</Text>
        {subtitle ? <Text style={[type.small, { marginTop: 2 }]}>{subtitle}</Text> : null}
      </View>
      {right}
      {onPress && actionLabel ? <Text style={styles.rowAction}>{actionLabel}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { paddingHorizontal: space(5) },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: space(3), marginBottom: space(4), minHeight: 48 },
  backBtn: {
    minHeight: 48,
    paddingHorizontal: space(3),
    borderRadius: radius.md,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  backText: { color: colors.text, fontWeight: '700', fontSize: 16 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(5),
  },
  btn: {
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(5),
    paddingVertical: space(3),
  },
  btnLabel: { fontWeight: '800', letterSpacing: 0.2 },
  btnSub: { fontSize: 14, fontWeight: '600', marginTop: 4, opacity: 0.85 },
  badge: { borderRadius: radius.pill, borderWidth: 1.5, paddingVertical: 4, alignSelf: 'flex-start' },
  stat: { flex: 1, gap: 4, minWidth: 0 },
  headlineNum: { fontWeight: '900', letterSpacing: -1, fontVariant: ['tabular-nums'], marginTop: 2 },
  kv: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: space(2), gap: space(3) },
  empty: { alignItems: 'center', paddingVertical: space(10), paddingHorizontal: space(4) },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: colors.borderHi,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space(5),
  },
  emptyDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.accent },
  notice: { borderLeftWidth: 4, backgroundColor: colors.surface, borderRadius: radius.md, padding: space(4) },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 4,
  },
  segmentItem: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm + 2 },
  segmentActive: { backgroundColor: colors.surfaceHi, borderWidth: 1, borderColor: colors.borderHi },
  segmentText: { color: colors.textSecondary, fontWeight: '800', fontSize: 15 },
  field: { flexDirection: 'row', alignItems: 'center', paddingVertical: space(3), minHeight: 64 },
  numberBox: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 120,
    minHeight: 52,
    borderRadius: radius.sm + 2,
    borderWidth: 1.5,
    borderColor: colors.borderHi,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: space(3),
  },
  numberInput: { flex: 1, color: colors.text, fontSize: 19, fontWeight: '800', textAlign: 'right', paddingVertical: 8 },
  affix: { color: colors.textTertiary, fontSize: 16, fontWeight: '700', marginHorizontal: 2 },
  textInput: {
    marginTop: space(2),
    minHeight: 52,
    borderRadius: radius.sm + 2,
    borderWidth: 1.5,
    borderColor: colors.borderHi,
    backgroundColor: colors.bgElevated,
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
    paddingHorizontal: space(4),
  },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space(3), minHeight: 64, gap: space(3), borderRadius: radius.sm },
  rowAction: { color: colors.accent, fontWeight: '800', fontSize: 15 },
});
