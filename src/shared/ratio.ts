// Ratio maths. The ratio is ALWAYS derived from dose and yield — it is never
// entered independently, so it can never disagree with them.

export function ratioOf(doseG: number, yieldG: number): number {
  if (!(doseG > 0) || !(yieldG >= 0)) return NaN;
  return yieldG / doseG;
}

/** 20 → 40 = "1:2", 20 → 45 = "1:2.25", 19.7 → 39.5 = "1:2.01" */
export function formatRatio(doseG: number, yieldG: number): string {
  const r = ratioOf(doseG, yieldG);
  if (!Number.isFinite(r)) return '—';
  return `1:${trimNumber(r, 2)}`;
}

/** Yield needed to hit a ratio for a dose, rounded to 0.5 g (what a scale can realistically hit). */
export function yieldForRatio(doseG: number, ratio: number): number {
  return roundTo(doseG * ratio, 0.5);
}

export function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function trimNumber(value: number, decimals = 1): string {
  return Number(value.toFixed(decimals)).toString();
}

export interface RatioCheck {
  consistent: boolean;
  actualRatio: number;
  message: string | null;
  /** The yield that would actually give the stated ratio. */
  yieldForStated: number | null;
}

/**
 * Checks a printed/stated ratio against its dose and yield.
 * Example: a bag that prints "1:2.25, 20 g in, 40 g out" is inconsistent —
 * 20 → 40 is 1:2, and a true 1:2.25 would be 45 g.
 */
export function checkStatedRatio(doseG: number, yieldG: number, statedRatio: number | null | undefined): RatioCheck {
  const actual = ratioOf(doseG, yieldG);
  if (statedRatio == null || !Number.isFinite(statedRatio) || !Number.isFinite(actual)) {
    return { consistent: true, actualRatio: actual, message: null, yieldForStated: null };
  }
  const yieldForStated = yieldForRatio(doseG, statedRatio);
  // Allow ±0.5 g of rounding on the yield.
  if (Math.abs(yieldG - doseG * statedRatio) <= 0.5) {
    return { consistent: true, actualRatio: actual, message: null, yieldForStated };
  }
  return {
    consistent: false,
    actualRatio: actual,
    yieldForStated,
    message:
      `Stated ratio 1:${trimNumber(statedRatio, 2)} does not match ${trimNumber(doseG)} g → ${trimNumber(yieldG)} g, ` +
      `which is ${formatRatio(doseG, yieldG)}. A true 1:${trimNumber(statedRatio, 2)} would be ${trimNumber(yieldForStated)} g.`,
  };
}

/** Days since roast, or null if the roast date is unknown. */
export function roastAgeDays(roastDate: string | null | undefined, at: Date | string = new Date()): number | null {
  if (!roastDate) return null;
  const roast = new Date(`${roastDate.slice(0, 10)}T00:00:00`);
  const ref = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(roast.getTime()) || Number.isNaN(ref.getTime())) return null;
  return Math.floor((ref.getTime() - roast.getTime()) / 86_400_000);
}
