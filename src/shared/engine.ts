// Deterministic recipe + dial-in engine (spec §7 and §8).
//
// It always works (no AI needed), it is predictable, and it enforces the house rules:
//   * change ONE major variable at a time (rule R6)
//   * grind for extraction problems, yield for strength/balance, temperature in 1 °C steps
//   * don't assume every sour shot needs a finer grind (puck prep / channeling)
// The optional AI layer may refine these suggestions, but its output is validated
// against the same rules (see `validateAiAdvice`).

import type {
  Advice, Adjustment, BrewPreferences, Coffee, Diagnosis, EquipmentLimits, RecipeParams, RoastLevel, Shot, ShotFields, TasteTag,
} from './types';
import { DEFAULT_LIMITS, DEFAULT_PREFERENCES } from './types';
import { formatRatio, roastAgeDays, roundTo, trimNumber, yieldForRatio } from './ratio';

// ---------------------------------------------------------------------------
// Starting recipe (spec §7)
// ---------------------------------------------------------------------------

interface RoastProfile { temperature_c: number; ratio: number; time_min_s: number; time_max_s: number; why: string }

export const ROAST_PROFILES: Record<RoastLevel, RoastProfile> = {
  light: { temperature_c: 94, ratio: 2.2, time_min_s: 28, time_max_s: 32, why: 'Light roast: dense and harder to extract, so a higher temperature and a slightly longer ratio.' },
  'light-medium': { temperature_c: 94, ratio: 2.1, time_min_s: 28, time_max_s: 32, why: 'Light-medium roast: a little extra heat and ratio for sweetness without over-extracting.' },
  medium: { temperature_c: 93, ratio: 2.0, time_min_s: 28, time_max_s: 32, why: 'Medium roast: 1:2 at 93 °C is a balanced starting point.' },
  'medium-dark': { temperature_c: 92, ratio: 2.0, time_min_s: 27, time_max_s: 30, why: 'Medium-dark roast extracts easily: slightly cooler and a touch quicker to avoid bitterness.' },
  dark: { temperature_c: 91, ratio: 2.0, time_min_s: 26, time_max_s: 30, why: 'Dark roast: cooler water and a shorter window keep bitterness down.' },
};

export interface RecipeContext {
  prefs?: BrewPreferences;
  /** Shots for this coffee (any order). */
  shotsThisCoffee?: Array<Pick<Shot, 'score' | 'pulled_at' | 'dose_g' | 'yield_g' | 'time_s' | 'temperature_c' | 'preinfusion_s' | 'grind_setting' | 'grind_inner'>>;
  /** Most recent shot on ANY coffee — only used as a grind hint. */
  lastShotAnyCoffee?: { grind_setting: number | null; coffee_name: string | null } | null;
  now?: Date;
}

export interface RecipeSuggestion { params: RecipeParams; rationale: string }

type CoffeeFacts = Pick<Coffee, 'roast_level' | 'roast_date' | 'processing' | 'tasting_notes' | 'field_sources'>;

export function suggestInitialRecipe(coffee: CoffeeFacts, ctx: RecipeContext = {}): RecipeSuggestion {
  const prefs = ctx.prefs ?? DEFAULT_PREFERENCES;
  const shots = ctx.shotsThisCoffee ?? [];
  const notes: string[] = [];

  // 1. Your own data beats generic rules.
  const best = bestShot(shots);
  if (best && (best.score ?? 0) >= 4) {
    notes.push(`Based on your best shot of this coffee (${best.pulled_at.slice(0, 10)}, ${best.score}/5): ${trimNumber(best.dose_g)} g → ${trimNumber(best.yield_g)} g (${formatRatio(best.dose_g, best.yield_g)}) in ${trimNumber(best.time_s)} s.`);
    notes.push(...roastAgeNotes(coffee.roast_date, ctx.now));
    return {
      params: {
        dose_g: best.dose_g,
        yield_g: best.yield_g,
        temperature_c: best.temperature_c ?? ROAST_PROFILES.medium.temperature_c,
        time_min_s: Math.max(best.time_s - 2, 15),
        time_max_s: best.time_s + 2,
        preinfusion_min_s: best.preinfusion_s ?? prefs.preinfusion_min_s,
        preinfusion_max_s: best.preinfusion_s ?? prefs.preinfusion_max_s,
        grind_setting: best.grind_setting,
        grind_inner: best.grind_inner,
      },
      rationale: notes.join(' '),
    };
  }

  // 2. Roast level drives temperature, ratio and time window.
  const roast = coffee.roast_level;
  const profile = roast ? ROAST_PROFILES[roast] : null;
  if (profile) {
    notes.push(coffee.field_sources?.roast_level === 'visual'
      ? `${profile.why} The roast level is a visual estimate, so treat this as a first guess.`
      : profile.why);
  } else {
    notes.push('Roast level unknown, so this uses medium-roast defaults. A bean photo or the bag details would help.');
  }
  const base = profile ?? { ...ROAST_PROFILES.medium, ratio: prefs.ratio, time_min_s: prefs.time_min_s, time_max_s: prefs.time_max_s };
  const params: RecipeParams = {
    dose_g: prefs.dose_g,
    yield_g: yieldForRatio(prefs.dose_g, base.ratio),
    temperature_c: base.temperature_c,
    time_min_s: base.time_min_s,
    time_max_s: base.time_max_s,
    preinfusion_min_s: prefs.preinfusion_min_s,
    preinfusion_max_s: prefs.preinfusion_max_s,
    grind_setting: null,
    grind_inner: null,
  };

  // 3. Hints — mentioned, deliberately NOT applied as rules.
  const tasting = (coffee.tasting_notes ?? []).join(' ').toLowerCase();
  if (/choc|cocoa|toffee|caramel|molasses|nut|hazelnut/.test(tasting)) {
    notes.push('Chocolate/caramel notes: 1:2 keeps the body; if it tastes heavy, add 2 g of yield.');
  } else if (/fruit|berry|citrus|orange|apple|floral|jasmine|bright/.test(tasting)) {
    notes.push('Fruit-forward notes: if it tastes sharp, try a longer ratio before going finer.');
  }
  if (coffee.processing && /natural/i.test(coffee.processing)) {
    notes.push('Natural process: not every natural needs a longer ratio, so let taste decide.');
  }

  // 4. Grind: only from your own history; grind numbers are grinder- and bean-specific.
  const lastHere = latest(shots.filter((s) => s.grind_setting != null));
  if (lastHere) {
    params.grind_setting = lastHere.grind_setting;
    params.grind_inner = lastHere.grind_inner;
    notes.push(`Grind: your last setting on this coffee (${formatGrind(lastHere.grind_setting, lastHere.grind_inner)}).`);
  } else if (ctx.lastShotAnyCoffee?.grind_setting != null) {
    notes.push(`Grind: no history for this coffee yet. Your last shot${ctx.lastShotAnyCoffee.coffee_name ? ` (${ctx.lastShotAnyCoffee.coffee_name})` : ''} used ${trimNumber(ctx.lastShotAnyCoffee.grind_setting)} — a place to start, but every bean differs.`);
  } else {
    notes.push('Grind: no history yet. Find the setting that lands the target time and record it.');
  }
  notes.push(...roastAgeNotes(coffee.roast_date, ctx.now));

  return { params, rationale: notes.join(' ') };
}

function roastAgeNotes(roastDate: string | null, now?: Date): string[] {
  const age = roastAgeDays(roastDate, now);
  if (age == null || age < 0) return [];
  if (age < 5) return [`Roasted ${age} day(s) ago: very fresh beans can gush and channel, so a few more days of rest may help.`];
  if (age > 42) return [`Roasted ${age} days ago: older beans tend to run faster, so expect to grind a bit finer.`];
  return [];
}

// ---------------------------------------------------------------------------
// Dial-in (spec §8)
// ---------------------------------------------------------------------------

export function formatGrind(setting: number | null | undefined, inner?: number | null): string {
  if (setting == null) return '—';
  return inner != null ? `${trimNumber(setting)} (inner ${inner})` : trimNumber(setting);
}

/** Moves the grind dial by `steps` toward finer or coarser, clamped to the grinder's range. */
export function stepGrind(setting: number | null, finer: boolean, steps: number, limits: EquipmentLimits = DEFAULT_LIMITS): number | null {
  if (setting == null) return null;
  const delta = (finer === limits.lower_is_finer ? -1 : 1) * steps;
  return Math.min(limits.grind_max, Math.max(limits.grind_min, setting + delta));
}

export interface DialInInput {
  shot: ShotFields;
  /** The recipe the shot was aiming for. If absent, the shot's own numbers are the baseline. */
  target?: RecipeParams | null;
  prefs?: BrewPreferences;
  limits?: EquipmentLimits;
}

/** The parameters the next shot starts from: the recipe, with the grind you ACTUALLY used (spec §8.2). */
export function nextShotBaseline(shot: ShotFields, target: RecipeParams | null | undefined, prefs: BrewPreferences = DEFAULT_PREFERENCES): RecipeParams {
  if (target) {
    return {
      ...target,
      temperature_c: target.temperature_c ?? shot.temperature_c ?? ROAST_PROFILES.medium.temperature_c,
      grind_setting: shot.grind_setting ?? target.grind_setting,
      grind_inner: shot.grind_inner ?? target.grind_inner,
    };
  }
  return {
    dose_g: shot.dose_g,
    yield_g: shot.yield_g,
    temperature_c: shot.temperature_c ?? ROAST_PROFILES.medium.temperature_c,
    time_min_s: prefs.time_min_s,
    time_max_s: prefs.time_max_s,
    preinfusion_min_s: shot.preinfusion_s ?? prefs.preinfusion_min_s,
    preinfusion_max_s: shot.preinfusion_s ?? prefs.preinfusion_max_s,
    grind_setting: shot.grind_setting,
    grind_inner: shot.grind_inner,
  };
}

const VERY = 6; // seconds outside the window that count as "very" fast/slow

export function recommendNextShot({ shot, target, prefs = DEFAULT_PREFERENCES, limits = DEFAULT_LIMITS }: DialInInput): Advice {
  const tags = new Set<TasteTag>(shot.taste_tags ?? []);
  const has = (t: TasteTag) => tags.has(t);

  const base = nextShotBaseline(shot, target, prefs);

  const tMin = base.time_min_s;
  const tMax = base.time_max_s;
  const t = shot.time_s;
  const fast = t < tMin;
  const slow = t > tMax;
  const veryFast = t < tMin - VERY;
  const verySlow = t > tMax + VERY;
  const window = `${trimNumber(tMin)}–${trimNumber(tMax)} s`;
  const timeDesc = fast ? `${trimNumber(t)} s is faster than the ${window} target`
    : slow ? `${trimNumber(t)} s is slower than the ${window} target`
    : `${trimNumber(t)} s is within the ${window} target`;
  const temp = base.temperature_c as number;
  const score = shot.score ?? null;

  const commonChecks: string[] = [];
  const dev = deviations(shot, target);
  if (dev) commonChecks.push(dev);

  const puckChecks = [
    'WDT all the way to the bottom of the basket and break up every clump.',
    'Make sure the bed is level before tamping and let the self-levelling tamper sit flat.',
    'Seat the puck screen flat and dose into a dry basket.',
  ];

  const mk = (rule: number, adjustment: Adjustment, diagnosis: Diagnosis, headline: string, explanation: string, next: RecipeParams, checks: string[] = [], promising = false): Advice => ({
    rule, adjustment, diagnosis, headline, explanation,
    checks: [...checks, ...commonChecks],
    next,
    promising,
    source: 'engine',
  });

  const grind = (finer: boolean, steps: number) => {
    const moved = stepGrind(base.grind_setting, finer, steps, limits);
    const dir = finer ? 'finer' : 'coarser';
    return {
      next: { ...base, grind_setting: moved ?? base.grind_setting },
      headline: moved != null && base.grind_setting != null
        ? `Grind ${dir}: ${trimNumber(base.grind_setting)} → ${trimNumber(moved)}`
        : `Grind ${steps} step${steps > 1 ? 's' : ''} ${dir}`,
    };
  };
  const tempUp = () => ({ ...base, temperature_c: temp + 1 });
  const tempDown = () => ({ ...base, temperature_c: temp - 1 });

  // Rule 1 — uneven extraction: channeling seen, or sour AND bitter together.
  if (has('channeling') || (has('sour') && has('bitter'))) {
    return mk(1, 'puck_prep', 'uneven', 'Keep the recipe, fix puck prep first',
      `${has('channeling') ? 'Spurting or uneven flow' : 'Sour and bitter in the same shot'} points to channeling: part of the puck over-extracts while the rest under-extracts. Changing the grind now would chase the wrong problem, so repeat the same recipe with careful prep.`,
      { ...base }, puckChecks);
  }

  // Rules 2–4 — sour.
  if (has('sour')) {
    if (fast) {
      const g = grind(true, veryFast ? 2 : 1);
      return mk(2, 'grind_finer', 'under', g.headline,
        `Sour and ${timeDesc}: classic under-extraction. Finer slows the shot and pulls more sweetness. Keep dose, yield and temperature the same.`, g.next);
    }
    if (slow) {
      return mk(3, 'puck_prep', 'uneven', 'Sour despite a slow shot: check for channeling',
        `${cap(timeDesc)}, yet it tastes sour. Slow-but-sour usually means water is channeling through part of the puck. Don't go finer; repeat with careful prep, and if it's still sour go one step coarser.`,
        { ...base }, puckChecks);
    }
    if (temp < limits.temp_max) {
      return mk(4, 'increase_temp', 'under', `Raise temperature to ${trimNumber(temp + 1)} °C`,
        `Sour while ${timeDesc}. The flow is right, so grinding finer would push the time out of range; one degree hotter extracts a little more without changing the flow.`,
        tempUp(), ['If the shot looked uneven, fix puck prep before changing anything.']);
    }
    const g = grind(true, 1);
    return mk(4, 'grind_finer', 'under', g.headline,
      `Sour while ${timeDesc}, and the temperature is already at the machine's maximum, so one step finer is the next lever.`, g.next);
  }

  // Rules 5–6 — dry / astringent.
  if (has('astringent')) {
    if (slow) {
      const g = grind(false, 1);
      return mk(5, 'grind_coarser', 'over', g.headline,
        `Dry and ${timeDesc}: likely over-extraction. One step coarser speeds it up.`, g.next,
        ['Dryness can also come from channeling, so keep puck prep consistent.']);
    }
    return mk(6, 'puck_prep', 'uneven', 'Check puck prep (possible channeling)',
      `Dryness while ${timeDesc} often comes from channeling rather than overall over-extraction. Repeat the same recipe with careful prep; if it's still dry, go one step coarser.`,
      { ...base }, puckChecks);
  }

  // Rules 7–9 — bitter.
  if (has('bitter')) {
    if (slow) {
      const g = grind(false, verySlow ? 2 : 1);
      return mk(7, 'grind_coarser', 'over', g.headline,
        `Bitter and ${timeDesc}: over-extraction. Coarser speeds the shot up; keep everything else the same.`, g.next);
    }
    if (fast) {
      return mk(8, 'puck_prep', 'uneven', 'Bitter but fast: check for channeling',
        `${cap(timeDesc)}, yet it's bitter. A fast bitter shot usually means channeling — water rushing through a crack and over-extracting that part. Repeat with careful prep before changing the grind.`,
        { ...base }, puckChecks);
    }
    if (temp > limits.temp_min) {
      return mk(9, 'decrease_temp', 'over', `Lower temperature to ${trimNumber(temp - 1)} °C`,
        `Bitter while ${timeDesc}. The flow is right, so instead of changing the grind, one degree cooler reduces harsh extraction.`, tempDown());
    }
    const g = grind(false, 1);
    return mk(9, 'grind_coarser', 'over', g.headline, 'Bitter and the temperature is already at the minimum, so one step coarser is next.', g.next);
  }

  // Rules 10–11 — thin / watery.
  if (has('thin')) {
    if (fast) {
      const g = grind(true, veryFast ? 2 : 1);
      return mk(10, 'grind_finer', 'under', g.headline,
        `Thin and ${timeDesc}: the water is passing too quickly. Finer adds body and sweetness.`, g.next);
    }
    const floor = roundTo(base.dose_g * 1.5, 0.5);
    const newYield = Math.max(floor, base.yield_g - 2);
    if (newYield >= base.yield_g) {
      return mk(11, 'keep', 'strength', 'Already at the shortest ratio',
        `Thin, but the yield is already at 1:1.5. Check the dose and puck prep before changing anything else.`, { ...base }, puckChecks);
    }
    return mk(11, 'decrease_yield', 'strength', `Reduce yield to ${trimNumber(newYield)} g`,
      `Thin while ${timeDesc}: extraction is fine, the shot is just diluted. A shorter ratio (${formatRatio(base.dose_g, newYield)}) gives more body.`,
      { ...base, yield_g: newYield });
  }

  // Rule 12 — heavy / too intense.
  if (has('heavy')) {
    const newYield = base.yield_g + 2;
    return mk(12, 'increase_yield', 'strength', `Increase yield to ${trimNumber(newYield)} g`,
      `Good but heavy: a slightly longer ratio (${formatRatio(base.dose_g, newYield)}) lightens the cup and often opens up sweetness. Keep the grind and expect a couple of seconds longer.`,
      { ...base, yield_g: newYield });
  }

  // Rule 13 — good but too acidic.
  if (has('too acidic')) {
    if (temp < limits.temp_max) {
      return mk(13, 'increase_temp', 'balance', `Raise temperature to ${trimNumber(temp + 1)} °C`,
        'Good flavour, but the acidity is a bit forward. One degree hotter rounds it off without changing the flow. If that overshoots, try 2 g more yield instead.', tempUp());
    }
    const newYield = base.yield_g + 2;
    return mk(13, 'increase_yield', 'balance', `Increase yield to ${trimNumber(newYield)} g`,
      'Good flavour but forward acidity, and the temperature is already at the maximum, so 2 g more yield should balance it.', { ...base, yield_g: newYield });
  }

  // Rule 14 — good, no faults.
  if (has('balanced') || has('sweet') || (score != null && score >= 4)) {
    const timeNote = fast || slow ? ` ${cap(timeDesc)}, but taste is what matters, so there's no need to chase the clock.` : '';
    return mk(14, 'keep', 'on-target', 'Keep this recipe: promising',
      `Tastes good with no faults.${timeNote} Repeat it to confirm, or change one variable at a time if you want to explore.`,
      { ...base }, [], true);
  }

  // Rules 15–16 — no taste information.
  if (fast || slow) {
    const g = grind(fast, (fast && veryFast) || (slow && verySlow) ? 2 : 1);
    return mk(15, fast ? 'grind_finer' : 'grind_coarser', 'time-only', g.headline,
      `No taste faults recorded, but ${timeDesc}. Bring the time into range with the grind first, then judge the taste.`, g.next,
      ['Add tasting notes next time: taste beats the timer.']);
  }
  return mk(16, 'keep', 'on-target', 'Keep the recipe and note how it tastes',
    `${cap(timeDesc)}. Without tasting notes there's nothing to correct yet. Repeat it and tag sour/bitter/sweet so the next suggestion can be specific.`,
    { ...base });
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function deviations(shot: ShotFields, target?: RecipeParams | null): string | null {
  if (!target) return null;
  const parts: string[] = [];
  if (Math.abs(shot.dose_g - target.dose_g) > 0.3) parts.push(`dose ${trimNumber(shot.dose_g)} g vs ${trimNumber(target.dose_g)} g planned`);
  if (Math.abs(shot.yield_g - target.yield_g) > 1.5) parts.push(`yield ${trimNumber(shot.yield_g)} g vs ${trimNumber(target.yield_g)} g planned`);
  if (shot.temperature_c != null && target.temperature_c != null && Math.abs(shot.temperature_c - target.temperature_c) >= 1) {
    parts.push(`temperature ${trimNumber(shot.temperature_c)} °C vs ${trimNumber(target.temperature_c)} °C planned`);
  }
  if (!parts.length) return null;
  return `This shot differed from the recipe (${parts.join('; ')}). Hit the planned numbers next time so the comparison is fair.`;
}

// ---------------------------------------------------------------------------
// Validation helpers (used for AI output and user edits)
// ---------------------------------------------------------------------------

export type MajorVariable = 'dose' | 'yield' | 'temperature' | 'grind' | 'preinfusion';

/** Which major variables differ between two parameter sets. */
export function changedVariables(a: RecipeParams, b: RecipeParams): MajorVariable[] {
  const out: MajorVariable[] = [];
  const diff = (x: number | null, y: number | null) => (x == null) !== (y == null) || (x != null && y != null && Math.abs(x - y) > 0.05);
  if (diff(a.dose_g, b.dose_g)) out.push('dose');
  if (diff(a.yield_g, b.yield_g)) out.push('yield');
  if (diff(a.temperature_c, b.temperature_c)) out.push('temperature');
  if (diff(a.grind_setting, b.grind_setting) || diff(a.grind_inner, b.grind_inner)) out.push('grind');
  if (diff(a.preinfusion_min_s, b.preinfusion_min_s) || diff(a.preinfusion_max_s, b.preinfusion_max_s)) out.push('preinfusion');
  return out;
}

export const RECIPE_BOUNDS = { dose_min: 17, dose_max: 22, ratio_min: 1.5, ratio_max: 3, time_min: 15, time_max: 40 };

/** Returns a list of problems; empty = within bounds (spec §7 AI refinement bounds). */
export function recipeBoundsProblems(p: RecipeParams, limits: EquipmentLimits = DEFAULT_LIMITS): string[] {
  const problems: string[] = [];
  const ratio = p.yield_g / p.dose_g;
  if (p.dose_g < RECIPE_BOUNDS.dose_min || p.dose_g > RECIPE_BOUNDS.dose_max) problems.push(`dose ${p.dose_g} g outside ${RECIPE_BOUNDS.dose_min}–${RECIPE_BOUNDS.dose_max} g`);
  if (!(ratio >= RECIPE_BOUNDS.ratio_min && ratio <= RECIPE_BOUNDS.ratio_max)) problems.push(`ratio ${formatRatio(p.dose_g, p.yield_g)} outside 1:${RECIPE_BOUNDS.ratio_min}–1:${RECIPE_BOUNDS.ratio_max}`);
  if (p.temperature_c == null || p.temperature_c < limits.temp_min || p.temperature_c > limits.temp_max || !Number.isInteger(p.temperature_c)) {
    problems.push(`temperature must be a whole number between ${limits.temp_min} and ${limits.temp_max} °C`);
  }
  if (p.time_min_s > p.time_max_s || p.time_min_s < RECIPE_BOUNDS.time_min || p.time_max_s > RECIPE_BOUNDS.time_max) problems.push('time window out of range');
  if (p.grind_setting != null && (p.grind_setting < limits.grind_min || p.grind_setting > limits.grind_max)) problems.push('grind setting outside the grinder range');
  return problems;
}

/**
 * Accepts an AI advice proposal only if it changes at most one major variable
 * versus the engine's baseline and stays within bounds (rule R6). Returns the
 * advice to store: the AI's if valid, otherwise the engine's.
 */
export function validateAiAdvice(engine: Advice, baseline: RecipeParams, ai: Omit<Advice, 'source' | 'rule'>, limits: EquipmentLimits = DEFAULT_LIMITS): { advice: Advice; accepted: boolean; reason?: string } {
  const changed = changedVariables(baseline, ai.next);
  if (changed.length > 1) return { advice: engine, accepted: false, reason: `AI changed ${changed.join(' and ')}; only one variable may change.` };
  const problems = recipeBoundsProblems(ai.next, limits);
  if (problems.length) return { advice: engine, accepted: false, reason: problems.join('; ') };
  if (ai.adjustment === 'keep' && changed.length) return { advice: engine, accepted: false, reason: 'AI said keep but changed a variable.' };
  return {
    accepted: true,
    advice: { ...ai, rule: null, source: 'ai', engine_adjustment: ai.adjustment !== engine.adjustment ? engine.adjustment : undefined },
  };
}

/** Best shot: highest score, ties → most recent (spec §5.8). */
export function bestShot<T extends Pick<Shot, 'score' | 'pulled_at'>>(shots: T[]): T | null {
  const rated = shots.filter((s) => s.score != null);
  if (!rated.length) return null;
  return [...rated].sort((a, b) => (b.score! - a.score!) || b.pulled_at.localeCompare(a.pulled_at))[0];
}

function latest<T extends Pick<Shot, 'pulled_at'>>(shots: T[]): T | null {
  if (!shots.length) return null;
  return [...shots].sort((a, b) => b.pulled_at.localeCompare(a.pulled_at))[0];
}
