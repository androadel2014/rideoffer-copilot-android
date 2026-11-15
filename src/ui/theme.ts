import type { TextStyle } from 'react-native';
import type { Verdict, ZoneClass } from '../engine/types';

export const colors = {
  bg: '#07090D',
  bgElevated: '#0C0F15',
  surface: '#121720',
  surfaceHi: '#192030',
  surfacePressed: '#202839',
  border: '#232A38',
  borderHi: '#323B4D',
  text: '#F3F5F9',
  textSecondary: '#A9B2C3',
  textTertiary: '#6E788C',
  accent: '#5B8CFF',
  accentPressed: '#4774E0',
  accentSoft: 'rgba(91,140,255,0.14)',
  accentText: '#0A1430',
  great: '#22C55E',
  greatSoft: 'rgba(34,197,94,0.14)',
  ok: '#F5B300',
  okSoft: 'rgba(245,179,0,0.14)',
  bad: '#F04452',
  badSoft: 'rgba(240,68,82,0.14)',
  check: '#8B95A8',
  checkSoft: 'rgba(139,149,168,0.16)',
  hot: '#FF8A4C',
  neutral: '#8FA3C7',
  dead: '#8B8FA0',
  danger: '#F04452',
  white: '#FFFFFF',
};

export const radius = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 };

export const space = (n: number) => n * 4;

export const type: Record<string, TextStyle> = {
  display: { fontSize: 40, fontWeight: '800', letterSpacing: -1, color: colors.text },
  h1: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5, color: colors.text },
  h2: { fontSize: 20, fontWeight: '700', letterSpacing: -0.2, color: colors.text },
  h3: { fontSize: 17, fontWeight: '700', color: colors.text },
  body: { fontSize: 16, fontWeight: '500', lineHeight: 23, color: colors.textSecondary },
  bodyStrong: { fontSize: 16, fontWeight: '700', color: colors.text },
  small: { fontSize: 14, fontWeight: '500', lineHeight: 20, color: colors.textSecondary },
  tiny: { fontSize: 12, fontWeight: '600', color: colors.textTertiary },
  label: { fontSize: 12, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase', color: colors.textTertiary },
  number: { fontSize: 24, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
};

export function verdictColor(v: Verdict | null): { fg: string; soft: string } {
  switch (v) {
    case 'GREAT':
      return { fg: colors.great, soft: colors.greatSoft };
    case 'OK':
      return { fg: colors.ok, soft: colors.okSoft };
    case 'BAD':
      return { fg: colors.bad, soft: colors.badSoft };
    default:
      return { fg: colors.check, soft: colors.checkSoft };
  }
}

export function zoneColor(z: ZoneClass): string {
  return z === 'hot' ? colors.hot : z === 'dead' ? colors.dead : colors.neutral;
}
