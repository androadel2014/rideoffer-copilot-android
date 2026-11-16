import type { TextStyle } from 'react-native';
import type { Verdict, ZoneClass } from '../engine/types';

/**
 * Dark theme, built in layers: a near-black canvas, then surfaces that step up in
 * lightness (surface → surfaceHi → raised) with hairline borders instead of shadows
 * (shadows don't read on dark). One cool accent for actions; the three verdict colours
 * are reserved for verdicts so they always mean the same thing.
 */
export const colors = {
  bg: '#090B10',
  bgElevated: '#0E1117',
  surface: '#12161E',
  surfaceHi: '#181D27',
  raised: '#1E2431',
  surfacePressed: '#232A38',
  border: 'rgba(255,255,255,0.07)',
  borderHi: 'rgba(255,255,255,0.12)',
  hairline: 'rgba(255,255,255,0.05)',
  text: '#F4F6FA',
  textSecondary: '#A7AFBF',
  textTertiary: '#6D7588',
  accent: '#7C8CFF',
  accentPressed: '#6574F0',
  accentSoft: 'rgba(124,140,255,0.14)',
  accentLine: 'rgba(124,140,255,0.38)',
  accentText: '#0B1030',
  great: '#2FD27B',
  greatSoft: 'rgba(47,210,123,0.12)',
  greatLine: 'rgba(47,210,123,0.38)',
  ok: '#FFC23D',
  okSoft: 'rgba(255,194,61,0.12)',
  okLine: 'rgba(255,194,61,0.38)',
  bad: '#FF5C6C',
  badSoft: 'rgba(255,92,108,0.12)',
  badLine: 'rgba(255,92,108,0.38)',
  check: '#98A2B3',
  checkSoft: 'rgba(152,162,179,0.14)',
  checkLine: 'rgba(152,162,179,0.34)',
  hot: '#FF8F5A',
  neutral: '#8FA6CF',
  dead: '#8B8FA0',
  star: '#FFD166',
  danger: '#FF5C6C',
  white: '#FFFFFF',
  black: '#000000',
};

export const radius = { xs: 8, sm: 12, md: 16, lg: 22, xl: 30, pill: 999 };

export const space = (n: number) => n * 4;

export const type: Record<string, TextStyle> = {
  display: { fontSize: 40, fontWeight: '800', letterSpacing: -1.2, color: colors.text },
  h1: { fontSize: 30, fontWeight: '800', letterSpacing: -0.8, color: colors.text },
  h2: { fontSize: 21, fontWeight: '700', letterSpacing: -0.3, color: colors.text },
  h3: { fontSize: 17, fontWeight: '700', letterSpacing: -0.1, color: colors.text },
  body: { fontSize: 16, fontWeight: '500', lineHeight: 23, color: colors.textSecondary },
  bodyStrong: { fontSize: 16, fontWeight: '700', color: colors.text },
  small: { fontSize: 14, fontWeight: '500', lineHeight: 20, color: colors.textSecondary },
  tiny: { fontSize: 12, fontWeight: '600', color: colors.textTertiary },
  label: { fontSize: 11.5, fontWeight: '800', letterSpacing: 1.3, textTransform: 'uppercase', color: colors.textTertiary },
  number: { fontSize: 26, fontWeight: '800', letterSpacing: -0.6, color: colors.text, fontVariant: ['tabular-nums'] },
  mono: { fontFamily: 'monospace', fontSize: 13, lineHeight: 19, color: colors.textSecondary },
};

export interface VerdictPalette {
  fg: string;
  soft: string;
  line: string;
}

export function verdictColor(v: Verdict | null): VerdictPalette {
  switch (v) {
    case 'GREAT':
      return { fg: colors.great, soft: colors.greatSoft, line: colors.greatLine };
    case 'OK':
      return { fg: colors.ok, soft: colors.okSoft, line: colors.okLine };
    case 'BAD':
      return { fg: colors.bad, soft: colors.badSoft, line: colors.badLine };
    default:
      return { fg: colors.check, soft: colors.checkSoft, line: colors.checkLine };
  }
}

export function zoneColor(z: ZoneClass): string {
  return z === 'hot' ? colors.hot : z === 'dead' ? colors.dead : colors.neutral;
}
