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
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatPerHour, formatPerMile } from '../engine/grading';
import { US_FORMAT, type MoneyFormat } from '../engine/market';
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
  const pad = { paddingTop: insets.top + space(3), paddingBottom: insets.bottom + space(8) + padBottom };
  if (!scroll) return <View style={[styles.screen, styles.scrollContent, pad, contentStyle]}>{children}</View>;
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.scrollContent, pad, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

export function TopBar({ title, subtitle, onBack, right }: { title: string; subtitle?: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <View style={styles.topBarWrap}>
      <View style={styles.topBar}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={12}
            style={({ pressed }) => [styles.backBtn, pressed && { backgroundColor: colors.surfacePressed }]}
          >
            <Text style={styles.backChevron}>‹</Text>
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={[type.h2, { fontSize: 22 }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[type.tiny, { marginTop: 2 }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right}
      </View>
    </View>
  );
}

/** Big page title for the tab screens. */
export function PageHeader({ kicker, title, right }: { kicker?: string; title: string; right?: React.ReactNode }) {
  return (
    <View style={styles.pageHeader}>
      <View style={{ flex: 1 }}>
        {kicker ? <Text style={[type.label, { color: colors.accent }]}>{kicker}</Text> : null}
        <Text style={[type.h1, { marginTop: kicker ? 4 : 0 }]}>{title}</Text>
      </View>
      {right}
    </View>
  );
}

export function Card({ children, style, tone }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; tone?: Verdict | 'CHECK' | 'accent' | null }) {
  const toneStyle =
    tone === 'accent'
      ? { backgroundColor: colors.accentSoft, borderColor: colors.accentLine }
      : tone !== undefined
        ? (() => {
            const c = verdictColor(tone === 'CHECK' ? null : tone);
            return { backgroundColor: c.soft, borderColor: c.line };
          })()
        : null;
  return <View style={[styles.card, toneStyle, style]}>{children}</View>;
}

export function SectionLabel({ children, style, right }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; right?: React.ReactNode }) {
  return (
    <View style={[styles.sectionLabel, style]}>
      <Text style={[type.label, { flex: 1 }]}>{children}</Text>
      {right}
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: colors.borderHi, marginVertical: space(3) }, style]} />;
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
  icon,
  style,
}: {
  label: string;
  sublabel?: string;
  onPress: () => void;
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg' | 'hero';
  disabled?: boolean;
  loading?: boolean;
  /** Small glyph shown before the label, e.g. "▶". */
  icon?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const v = VARIANTS[variant];
  const h = size === 'hero' ? 104 : size === 'lg' ? 62 : size === 'sm' ? 44 : 54;
  const fs = size === 'hero' ? 26 : size === 'lg' ? 18 : size === 'sm' ? 15 : 16.5;
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
        size === 'sm' && { paddingHorizontal: space(4), borderRadius: radius.sm },
        (disabled || loading) && { opacity: 0.45 },
        pressed && { transform: [{ scale: 0.985 }] },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
            {icon ? <Text style={{ color: v.fg, fontSize: fs * 0.8, fontWeight: '900' }}>{icon}</Text> : null}
            <Text style={[styles.btnLabel, { color: v.fg, fontSize: fs }]}>{label}</Text>
          </View>
          {sublabel ? <Text style={[styles.btnSub, { color: v.sub }]}>{sublabel}</Text> : null}
        </>
      )}
    </Pressable>
  );
}

const VARIANTS: Record<Variant, { bg: string; pressed: string; fg: string; sub: string; border: string }> = {
  primary: { bg: colors.accent, pressed: colors.accentPressed, fg: '#0A0E26', sub: 'rgba(10,14,38,0.72)', border: colors.accent },
  success: { bg: colors.great, pressed: '#27B96B', fg: '#03170B', sub: 'rgba(3,23,11,0.72)', border: colors.great },
  secondary: { bg: colors.surfaceHi, pressed: colors.surfacePressed, fg: colors.text, sub: colors.textSecondary, border: colors.borderHi },
  danger: { bg: colors.badSoft, pressed: 'rgba(255,92,108,0.2)', fg: colors.bad, sub: colors.bad, border: colors.badLine },
  ghost: { bg: 'transparent', pressed: colors.surfacePressed, fg: colors.accent, sub: colors.textSecondary, border: 'transparent' },
};

// ---------------------------------------------------------------------------------------
// Data display
// ---------------------------------------------------------------------------------------

export function VerdictBadge({ verdict, size = 'md' }: { verdict: Verdict | null; size?: 'sm' | 'md' | 'lg' }) {
  const c = verdictColor(verdict);
  const fs = size === 'lg' ? 20 : size === 'sm' ? 11.5 : 13.5;
  return (
    <View style={[styles.badge, { backgroundColor: c.fg, paddingHorizontal: fs * 0.85, paddingVertical: fs * 0.32 }]}>
      <Text style={{ color: '#0A0C10', fontWeight: '900', fontSize: fs, letterSpacing: 1.1 }}>{verdict ?? 'CHECK'}</Text>
    </View>
  );
}

export function Chip({ label, tone, icon, style }: { label: string; tone?: string; icon?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.chip, tone ? { borderColor: tone } : null, style]}>
      {icon ? <Text style={{ color: tone ?? colors.textSecondary, fontSize: 12, fontWeight: '900' }}>{icon}</Text> : null}
      <Text style={[styles.chipText, tone ? { color: tone } : null]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * The in-app twin of the overlay: NET $/hr and NET $/mi (or /km) as the two big numbers,
 * with the verdict pill and the reason underneath.
 */
export function RateHeadline({
  verdict,
  netPerHour,
  netPerMile,
  reason,
  detail,
  compact,
  fmt = US_FORMAT,
}: {
  verdict: Verdict | null;
  netPerHour: number | null;
  netPerMile: number | null;
  reason?: string;
  detail?: string;
  compact?: boolean;
  fmt?: MoneyFormat;
}) {
  const c = verdictColor(verdict);
  const size = compact ? 32 : 40;
  return (
    <View>
      <View style={{ flexDirection: 'row', gap: space(4) }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={type.label}>Net / hour</Text>
          <Text style={[styles.headlineNum, { fontSize: size, color: c.fg }]} numberOfLines={1} adjustsFontSizeToFit>
            {formatPerHour(netPerHour, fmt)}
          </Text>
        </View>
        <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: colors.borderHi, marginVertical: 4 }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={type.label}>Net / {fmt.unit === 'km' ? 'km' : 'mile'}</Text>
          <Text style={[styles.headlineNum, { fontSize: size, color: c.fg }]} numberOfLines={1} adjustsFontSizeToFit>
            {formatPerMile(netPerMile, fmt)}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), marginTop: space(3) }}>
        <VerdictBadge verdict={verdict} size={compact ? 'sm' : 'md'} />
        {reason ? (
          <Text style={[type.bodyStrong, { flex: 1, fontSize: compact ? 15 : 16 }]} numberOfLines={2}>
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
      <Text style={type.label} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[type.number, tone ? { color: tone } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {hint ? (
        <Text style={type.tiny} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** A small tile with a label, a prominent value and an optional line under it. */
export function MetricTile({ label, value, sub, tone, emphasis }: { label: string; value: string; sub?: string; tone?: string; emphasis?: boolean }) {
  return (
    <View style={[styles.tile, emphasis && { backgroundColor: colors.raised, borderColor: colors.borderHi }]}>
      <Text style={type.label} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={[styles.tileValue, tone ? { color: tone } : null, emphasis && { fontSize: 24 }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      {sub ? (
        <Text style={[type.tiny, { color: colors.textSecondary }]} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

export function KeyValue({
  k,
  v,
  mono,
  strong,
  tone,
  sub,
  last,
}: {
  k: string;
  v: string;
  mono?: boolean;
  strong?: boolean;
  tone?: string;
  sub?: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.kv, !last && styles.kvBorder]}>
      <View style={{ flex: 1, minWidth: 96, paddingRight: space(2) }}>
        <Text style={[type.small, strong && { color: colors.text, fontWeight: '700' }]}>{k}</Text>
        {sub ? <Text style={[type.tiny, { marginTop: 2 }]}>{sub}</Text> : null}
      </View>
      <Text
        style={[
          type.bodyStrong,
          { flexShrink: 1, textAlign: 'right' },
          mono && { fontVariant: ['tabular-nums'] },
          strong && { fontSize: 17, fontWeight: '800' },
          tone ? { color: tone } : null,
        ]}
        selectable
      >
        {v}
      </Text>
    </View>
  );
}

/**
 * Pickup vs trip as one bar whose segments are proportional to distance, so the share of
 * unpaid driving to the pickup is visible at a glance.
 */
export function DistanceBar({ pickup, trip, extra }: { pickup: number | null; trip: number | null; extra?: number | null }) {
  const p = Math.max(0, pickup ?? 0);
  const t = Math.max(0, trip ?? 0);
  const e = Math.max(0, extra ?? 0);
  const sum = p + t + e;
  if (!(sum > 0)) return null;
  const seg = (n: number) => ({ flex: Math.max(n / sum, n > 0 ? 0.04 : 0) });
  return (
    <View>
      <View style={styles.distBar}>
        {p > 0 ? <View style={[seg(p), { backgroundColor: colors.accent }]} /> : null}
        {t > 0 ? <View style={[seg(t), { backgroundColor: colors.great }]} /> : null}
        {e > 0 ? <View style={[seg(e), { backgroundColor: colors.dead }]} /> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: space(4), marginTop: space(2) }}>
        <Legend color={colors.accent} label="Pickup" />
        <Legend color={colors.great} label="Trip" />
        {e > 0 ? <Legend color={colors.dead} label="Return (dead zone)" /> : null}
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={type.tiny}>{label}</Text>
    </View>
  );
}

/** Five stars filled to the rating (rounded to the nearest half), plus the number. */
export function Stars({ rating, label, size = 18 }: { rating: number | null; label?: string; size?: number }) {
  if (rating == null) return <Text style={type.bodyStrong}>Not shown</Text>;
  const halves = Math.round(Math.max(0, Math.min(5, rating)) * 2);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
      <View style={{ flexDirection: 'row', gap: 2 }}>
        {[0, 1, 2, 3, 4].map((i) => {
          const fill = halves >= (i + 1) * 2 ? 1 : halves === i * 2 + 1 ? 0.5 : 0;
          return (
            <View key={i} style={{ width: size, height: size }}>
              <Text style={{ position: 'absolute', color: colors.raised, fontSize: size, lineHeight: size + 2 }}>★</Text>
              {fill > 0 ? (
                <View style={{ position: 'absolute', width: size * fill, height: size + 2, overflow: 'hidden' }}>
                  <Text style={{ color: colors.star, fontSize: size, lineHeight: size + 2 }}>★</Text>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
      <Text style={[type.bodyStrong, { fontVariant: ['tabular-nums'] }]}>{label ?? rating.toFixed(2)}</Text>
    </View>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <View style={styles.emptyRing} />
        <View style={styles.emptyDot} />
      </View>
      <Text style={[type.h2, { textAlign: 'center' }]}>{title}</Text>
      <Text style={[type.body, { textAlign: 'center', marginTop: space(2) }]}>{body}</Text>
      {action ? <View style={{ marginTop: space(5), alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

export function Notice({ tone = 'info', title, body, children }: { tone?: 'info' | 'warn' | 'bad' | 'good'; title: string; body?: string; children?: React.ReactNode }) {
  const c =
    tone === 'warn'
      ? { fg: colors.ok, soft: colors.okSoft, line: colors.okLine }
      : tone === 'bad'
        ? { fg: colors.bad, soft: colors.badSoft, line: colors.badLine }
        : tone === 'good'
          ? { fg: colors.great, soft: colors.greatSoft, line: colors.greatLine }
          : { fg: colors.accent, soft: colors.accentSoft, line: colors.accentLine };
  return (
    <View style={[styles.notice, { backgroundColor: c.soft, borderColor: c.line }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.fg }} />
        <Text style={[type.bodyStrong, { color: c.fg, flex: 1 }]}>{title}</Text>
      </View>
      {body ? <Text style={[type.small, { marginTop: space(1), color: colors.text, opacity: 0.86 }]}>{body}</Text> : null}
      {children}
    </View>
  );
}

/** Round badge with a glyph, used for steps and section heroes. */
export function IconCircle({ glyph, tone = colors.accent, size = 44, filled }: { glyph: string; tone?: string; size?: number; filled?: boolean }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: filled ? tone : 'transparent',
        borderWidth: filled ? 0 : 1.5,
        borderColor: tone,
      }}
    >
      <Text style={{ color: filled ? '#0A0C10' : tone, fontSize: size * 0.42, fontWeight: '900' }}>{glyph}</Text>
    </View>
  );
}

/** "Step 1 of 2" style progress used in the Start Watching flow and onboarding. */
export function StepDots({ count, index }: { count: number; index: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: space(2) }}>
      {Array.from({ length: count }, (_, k) => (
        <View
          key={k}
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            backgroundColor: k < index ? colors.accent : k === index ? colors.accent : colors.raised,
            opacity: k < index ? 0.55 : 1,
          }}
        />
      ))}
    </View>
  );
}

/**
 * A phone showing a driver-app offer card with the verdict floating on top of it —
 * what the driver will see. Used in onboarding and the overlay permission step.
 */
export function OverlayMock({ verdict = 'GREAT', scale = 1 }: { verdict?: Verdict; scale?: number }) {
  const c = verdictColor(verdict);
  const s = (n: number) => n * scale;
  return (
    <View style={[styles.phone, { width: s(250), height: s(330), borderRadius: s(36), padding: s(12) }]}>
      <View style={[styles.mapArea, { borderRadius: s(24) }]}>
        <View style={[styles.mapRoad, { top: '30%', transform: [{ rotate: '-12deg' }] }]} />
        <View style={[styles.mapRoad, { top: '58%', transform: [{ rotate: '8deg' }] }]} />
      </View>
      <View style={[styles.mockCard, { borderRadius: s(20), padding: s(12), paddingTop: s(14) }]}>
        <View style={[styles.mockVerdict, { backgroundColor: c.fg, borderRadius: s(16), padding: s(10), marginTop: -s(42) }]}>
          <View style={{ flexDirection: 'row', gap: s(8) }}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.mockLabel, { fontSize: s(7.5) }]}>NET / HOUR</Text>
              <Text style={[styles.mockNum, { fontSize: s(19) }]}>$36/hr</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.mockLabel, { fontSize: s(7.5) }]}>NET / MILE</Text>
              <Text style={[styles.mockNum, { fontSize: s(19) }]}>$1.42/mi</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: s(6), marginTop: s(6) }}>
            <Text style={[styles.mockPill, { color: c.fg, fontSize: s(9), paddingHorizontal: s(7), paddingVertical: s(2), borderRadius: s(8) }]}>
              {verdict}
            </Text>
            <Text style={[styles.mockReason, { fontSize: s(9) }]} numberOfLines={1}>
              $19.80 · 12.4 mi · 26 min · ★ 4.93
            </Text>
          </View>
        </View>
        <View style={{ gap: s(7), marginTop: s(10) }}>
          <View style={[styles.mockLine, { width: '62%', height: s(8) }]} />
          <View style={[styles.mockLine, { width: '84%', height: s(8) }]} />
          <View style={[styles.mockLine, { width: '50%', height: s(8) }]} />
        </View>
        <View style={[styles.mockAccept, { height: s(30), borderRadius: s(10), marginTop: s(12) }]}>
          <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: s(11) }}>Accept</Text>
        </View>
      </View>
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
            <Text style={[styles.segmentText, active && { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Numeric field that only commits valid numbers (on blur / submit). Accepts "12,50" too. */
export function NumberField({
  label,
  help,
  value,
  onCommit,
  prefix,
  suffix,
  decimals = 2,
  last,
}: {
  label: string;
  help?: string;
  value: number;
  onCommit: (n: number) => void;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  last?: boolean;
}) {
  const fmt = (n: number) => (decimals === 0 ? String(Math.round(n)) : String(+n.toFixed(decimals)));
  const [text, setText] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);
  const commit = () => {
    const n = parseFloat(text.replace(/[٫,]/g, '.').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)));
    if (Number.isFinite(n)) onCommit(n);
    else setText(fmt(value));
  };
  return (
    <View style={[styles.field, !last && styles.fieldBorder]}>
      <View style={{ flex: 1, paddingRight: space(3) }}>
        <Text style={type.bodyStrong}>{label}</Text>
        {help ? <Text style={[type.small, { marginTop: 2 }]}>{help}</Text> : null}
      </View>
      <View style={[styles.numberBox, focused && { borderColor: colors.accent, backgroundColor: colors.surfaceHi }]}>
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
        style={[styles.textInput, focused && { borderColor: colors.accent, backgroundColor: colors.surfaceHi }]}
      />
    </View>
  );
}

export function ToggleRow({
  label,
  help,
  value,
  onChange,
  last,
}: {
  label: string;
  help?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      style={[styles.field, !last && styles.fieldBorder]}
    >
      <View style={{ flex: 1, paddingRight: space(3) }}>
        <Text style={type.bodyStrong}>{label}</Text>
        {help ? <Text style={[type.small, { marginTop: 2 }]}>{help}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.raised, true: colors.accent }}
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
  titleStyle,
  last,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  actionLabel?: string;
  titleStyle?: StyleProp<TextStyle>;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={actionLabel ? `${title}. ${actionLabel}` : title}
      style={({ pressed }) => [styles.listRow, !last && styles.fieldBorder, pressed && { opacity: 0.7 }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[type.bodyStrong, titleStyle]}>{title}</Text>
        {subtitle ? <Text style={[type.small, { marginTop: 2 }]}>{subtitle}</Text> : null}
      </View>
      {right}
      {onPress && actionLabel ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={styles.rowAction}>{actionLabel}</Text>
          <Text style={[styles.rowAction, { fontSize: 20, marginTop: -2 }]}>›</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { paddingHorizontal: space(5) },
  topBarWrap: { marginBottom: space(4) },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: 48 },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderHi,
    backgroundColor: colors.surface,
  },
  backChevron: { color: colors.text, fontSize: 30, fontWeight: '400', marginTop: -4, marginLeft: -2 },
  pageHeader: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: space(5), marginTop: space(2) },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(5),
  },
  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space(7),
    marginBottom: space(3),
    paddingHorizontal: space(1),
  },
  btn: {
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(5),
    paddingVertical: space(3),
  },
  btnLabel: { fontWeight: '800', letterSpacing: 0.1 },
  btnSub: { fontSize: 13.5, fontWeight: '600', marginTop: 4 },
  badge: { borderRadius: radius.pill, alignSelf: 'flex-start' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderHi,
    backgroundColor: colors.surfaceHi,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  chipText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  stat: { flex: 1, gap: 4, minWidth: 0 },
  tile: {
    flex: 1,
    minWidth: 0,
    gap: 4,
    backgroundColor: colors.surfaceHi,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: space(3),
    paddingHorizontal: space(3),
  },
  tileValue: { color: colors.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
  headlineNum: { fontWeight: '900', letterSpacing: -1.4, fontVariant: ['tabular-nums'], marginTop: 2 },
  kv: { flexDirection: 'row', alignItems: 'center', paddingVertical: space(3), gap: space(3), minHeight: 48 },
  kvBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderHi },
  distBar: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 3, backgroundColor: colors.bg },
  empty: { alignItems: 'center', paddingVertical: space(12), paddingHorizontal: space(4) },
  emptyIcon: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center', marginBottom: space(5) },
  emptyRing: {
    position: 'absolute',
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 1.5,
    borderColor: colors.accentLine,
    backgroundColor: colors.accentSoft,
  },
  emptyDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.accent },
  notice: { borderWidth: 1, borderRadius: radius.md, padding: space(4) },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 4,
    gap: 4,
  },
  segmentItem: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, paddingHorizontal: 6 },
  segmentActive: { backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.borderHi },
  segmentText: { color: colors.textTertiary, fontWeight: '800', fontSize: 14.5 },
  field: { flexDirection: 'row', alignItems: 'center', paddingVertical: space(3), minHeight: 64 },
  fieldBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderHi },
  numberBox: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 124,
    minHeight: 50,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderHi,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: space(3),
  },
  numberInput: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '800', textAlign: 'right', paddingVertical: 8 },
  affix: { color: colors.textTertiary, fontSize: 15, fontWeight: '700', marginHorizontal: 2 },
  textInput: {
    marginTop: space(2),
    minHeight: 52,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderHi,
    backgroundColor: colors.bgElevated,
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
    paddingHorizontal: space(4),
  },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space(3), minHeight: 60, gap: space(3) },
  rowAction: { color: colors.accent, fontWeight: '800', fontSize: 15 },
  // Overlay mock
  phone: { alignSelf: 'center', borderWidth: 1.5, borderColor: colors.borderHi, backgroundColor: '#0B0E14', overflow: 'hidden' },
  mapArea: { ...StyleSheet.absoluteFillObject, margin: 12, backgroundColor: '#141A24', overflow: 'hidden' },
  mapRoad: { position: 'absolute', left: -20, right: -20, height: 10, backgroundColor: '#1D2532' },
  mockCard: { position: 'absolute', left: 12, right: 12, bottom: 12, backgroundColor: '#F5F6F8' },
  mockVerdict: {},
  mockLabel: { color: '#fff', fontWeight: '800', letterSpacing: 1, opacity: 0.85 },
  mockNum: { color: '#fff', fontWeight: '900', letterSpacing: -0.6 },
  mockPill: { backgroundColor: '#fff', fontWeight: '900', overflow: 'hidden' },
  mockReason: { color: '#fff', fontWeight: '700', flex: 1 },
  mockLine: { borderRadius: 5, backgroundColor: '#D9DDE4' },
  mockAccept: { backgroundColor: '#1F2633', alignItems: 'center', justifyContent: 'center' },
});
