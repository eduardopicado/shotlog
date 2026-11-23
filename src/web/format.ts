import type { CoffeeStatus, FieldSource, RecipeParams, RoastLevel } from '../shared/types';
import { formatRatio, trimNumber } from '../shared/ratio';
import { formatGrind } from '../shared/engine';

export { formatRatio, trimNumber, formatGrind };

export const g = (n: number | null | undefined) => (n == null ? '—' : `${trimNumber(n)} g`);
export const s = (n: number | null | undefined) => (n == null ? '—' : `${trimNumber(n)} s`);
export const temp = (n: number | null | undefined) => (n == null ? 'temp not stated' : `${trimNumber(n)} °C`);

export const range = (a: number | null | undefined, b: number | null | undefined, unit: string) => {
  if (a == null && b == null) return '—';
  if (a == null || b == null || a === b) return `${trimNumber((a ?? b)!)} ${unit}`;
  return `${trimNumber(a)}–${trimNumber(b)} ${unit}`;
};

/** "20 g → 40 g · 1:2 · 93 °C · 28–32 s" */
export function recipeLine(r: RecipeParams): string {
  return `${g(r.dose_g)} → ${g(r.yield_g)} · ${formatRatio(r.dose_g, r.yield_g)} · ${temp(r.temperature_c)} · ${range(r.time_min_s, r.time_max_s, 's')}`;
}

export const ROAST_LABELS: Record<RoastLevel, string> = {
  light: 'Light', 'light-medium': 'Light-medium', medium: 'Medium', 'medium-dark': 'Medium-dark', dark: 'Dark',
};

export const STATUS_LABELS: Record<CoffeeStatus, string> = {
  active: 'In use', historical: 'Imported', finished: 'Finished', archived: 'Archived',
};

export const SOURCE_LABELS: Record<FieldSource, string> = {
  packaging: 'Packaging', visual: 'Estimated', user: 'You', historical: 'Imported',
};

export function dateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function dateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function roastAge(days: number | null): string | null {
  if (days == null) return null;
  if (days < 0) return 'roast date in the future';
  return days === 1 ? '1 day off roast' : `${days} days off roast`;
}
