import { formatPerHour, formatPerMile, money } from '../engine/grading';
import { US_FORMAT, type MoneyFormat } from '../engine/market';
import type { GradeResult } from '../engine/types';

/**
 * vc13 (owner's decision): the verdict shows GROSS and NET side by side.
 *
 * Display only. Both figures come straight from the locked grading engine's result
 * (grossPerHour / grossPerMile / netPerHour / netPerMile). The verdict is still graded on
 * the net figures, exactly as before. Net = after the cost-per-mile setting.
 */
export interface GrossNetFields {
  grossHour: string;
  grossMile: string;
  grossHourLabel: string;
  grossMileLabel: string;
  /** e.g. "Net = after $0.30/mi car cost". */
  netNote: string;
}

export function grossNetFields(grade: GradeResult, costPerMile: number, fmt: MoneyFormat = US_FORMAT): GrossNetFields {
  const unit = fmt.unit === 'km' ? 'km' : 'mi';
  const gradable = grade.gradable;
  return {
    grossHour: gradable ? formatPerHour(grade.grossPerHour, fmt) : '—',
    grossMile: gradable ? formatPerMile(grade.grossPerMile, fmt) : '—',
    grossHourLabel: 'GROSS / HOUR',
    grossMileLabel: unit === 'km' ? 'GROSS / KM' : 'GROSS / MILE',
    netNote: `Net = after ${money(costPerMile, fmt)}/${unit} car cost`,
  };
}
