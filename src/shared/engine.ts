// Deterministic recipe + dial-in engine.
//
// This is the backbone of the recommendations: it always works (no AI needed),
// it is predictable, and it enforces the house rules:
//   * change ONE major variable at a time
//   * prefer grind for extraction problems, yield for strength/balance,
//     temperature in 1 °C steps
//   * don't assume every sour shot needs a finer grind (puck prep / channeling)
// The optional AI layer may refine these suggestions, but its output is validated
// against the same rules (see `changedVariables`).

import type {
  Advice, Adjustment, BrewPreferences, Coffee, RecipeParams, RoastLevel, Shot, TasteTag,
} from './types';
import { DEFAULT_PREFERENCES } from './types';
import { formatRatio, ratioOf, roastAgeDays, roundTo, trimNumber, yieldForRatio } from './ratio';

export const MACHINE_TEMP_MIN = 86; // Breville Dual Boiler adjustable range
export const MACHINE_TEMP_MAX = 96;

interface RoastProfile { temperature_c: number; ratio: number; time_min_s: number; time_max_s: number; why: string }

const ROAST_PROFILES: Record<RoastLevel, RoastProfile> = {
  light: { temperature_c: 94, ratio: 2.2, time_min_s: 28, time_max_s: 32, why: 'Light roasts are dense and harder to extract: higher temperature and a slightly longer ratio.' },
  'light-medium': { temperature_c: 94, ratio: 2.1, time_min_s: 28, time_max_s: 32, why: 'Light-medium roast: a little extra heat and ratio helps sweetness without over-extracting.' },
  medium: { temperature_c: 93, ratio: 2.0, time_min_s: 28, time_max_s: 32, why: 'Medium roast: classic 1:2 at 93 °C is a balanced starting point.' },
  'medium-dark': { temperature_c: 92, ratio: 2.0, time_min_s: 27, time_max_s: 30, why: 'Medium-dark roast extracts easily: slightly cooler and a touch quicker to avoid bitterness.' },
  dark: { temperature_c: 91, ratio: 2.0, time_min_s: 26, time_max_s: 30, why: 'Dark roast: cooler water and a shorter window keep bitterness and ashiness down.' },
};

export interface RecipeContext {
  prefs?: BrewPreferences;
  /** Best-rated shot for this coffee (score >= 4), if any. */
  bestShot?: Shot | null;
  /** Most recent shot on this coffee, if any. */
  lastShotThisCoffee?: Shot | null;
  /** Most recent shot on ANY coffee — only used as a rough grind hint. */
  lastShotAnyCoffee?: { shot: Shot; coffeeName: string } | null;
  now?: Date;
}

export interface RecipeSuggestion { params: RecipeParams; rationale: string }

export function suggestInitialRecipe(coffee: Pick<Coffee, 'roast_level' | 'roast_date' | 'processing' | 'tasting_notes' | 'field_sources'>, ctx: RecipeContext = {}): RecipeSuggestion {
  const prefs = ctx.prefs ?? DEFAULT_PREFERENCES;
  const notes: string[] = [];

  // 1. Your own data beats generic rules.
  const best = ctx.bestShot;
  if (best && (best.score ?? 0) >= 4) {
    const params: RecipeParams = {
      dose_g: best.dose_g,
      yield_g: best.yield_g,
      temperature_c: best.temperature_c ?? 93,
      time_min_s: Math.max(best.time_s - 2, 20),
      time_max_s: best.time_s + 2,
      preinfusion_min_s: best.preinfusion_s ?? prefs.preinfusion_min_s,
      preinfusion_max_s: best.preinfusion_s ?? prefs.preinfusion_max_s,
      grinder_setting: best.grinder_setting,
    };
    notes.push(`Based on your best shot of this coffee (${best.pulled_at.slice(0, 10)}, ${best.score}/5): ${trimNumber(best.dose_g)} g → ${trimNumber(best.yield_g)} g (${formatRatio(best.dose_g, best.yield_g)}) in ${best.time_s} s.`);
    notes.push(...roastAgeNotes(coffee.roast_date, ctx.now));
    return { params, rationale: notes.join(' ') };
  }

  // 2. Roast level drives temperature, ratio and time window.
  const roast = coffee.roast_level;
  const profile = roast ? ROAST_PROFILES[roast] : ROAST_PROFILES.medium;
  if (roast) {
    const estimated = coffee.field_sources?.roast_level === 'visual';
    notes.push(estimated ? `${profile.why} (Roast level is a visual estimate, so treat this as a first guess.)` : profile.why);
  } else {
    notes.push('Roast level unknown, so this uses medium-roast defaults (93 °C, 1:2). A bean photo or the bag details would help.');
  }

  const ratio = roast ? profile.ratio : prefs.ratio;
  const dose = prefs.dose_g;
  const params: RecipeParams = {
    dose_g: dose,
    yield_g: yieldForRatio(dose, ratio),
    temperature_c: profile.temperature_c,
    time_min_s: profile.time_min_s,
    time_max_s: profile.time_max_s,
    preinfusion_min_s: prefs.preinfusion_min_s,
    preinfusion_max_s: prefs.preinfusion_max_s,
    grinder_setting: null,
  };

  // 3. Profile hints — mentioned, deliberately NOT applied as rules.
  const tasting = (coffee.tasting_notes ?? []).join(' ').toLowerCase();
  if (/choc|cocoa|toffee|caramel|molasses|nut|hazelnut/.test(tasting)) {
    notes.push('Chocolate/caramel notes: 1:2 keeps body; if it tastes heavy, stretch the yield by 2 g.');
  } else if (/fruit|berry|citrus|orange|apple|floral|jasmine|bright/.test(tasting)) {
    notes.push('Fruit-forward notes: if it tastes sharp at this ratio, try a longer ratio before going finer.');
  }
  if (coffee.processing && /natural/i.test(coffee.processing)) {
    notes.push('Natural process noted — not every natural needs a longer ratio, so start here and let taste decide.');
  }

  // 4. Grind: only from your own history; grind numbers are grinder- and bean-specific.
  if (ctx.lastShotThisCoffee?.grinder_setting) {
    params.grinder_setting = ctx.lastShotThisCoffee.grinder_setting;
    notes.push(`Grind: start from your last setting on this coffee (${ctx.lastShotThisCoffee.grinder_setting}).`);
  } else if (ctx.lastShotAnyCoffee?.shot.grinder_setting) {
    notes.push(`Grind: no history for this coffee. Your last shot (${ctx.lastShotAnyCoffee.coffeeName}) used ${ctx.lastShotAnyCoffee.shot.grinder_setting} — a reasonable place to start, but every bean differs.`);
  } else {
    notes.push('Grind: no history yet — find the setting that lands the target time and record it.');
  }
  notes.push(...roastAgeNotes(coffee.roast_date, ctx.now));

  return { params, rationale: notes.join(' ') };
}

function roastAgeNotes(roastDate: string | null, now?: Date): string[] {
  const age = roastAgeDays(roastDate, now);
  if (age == null) return [];
  if (age < 0) return [];
  if (age < 5) return [`Roasted ${age} day(s) ago — very fresh beans can gush and channel; a few more days of rest may help.`];
  if (age > 42) return [`Roasted ${age} days ago — older beans tend to run faster, so expect to grind a bit finer.`];
  return [];
}

// ---------------------------------------------------------------------------
// Dial-in: what to change for the next shot
// ---------------------------------------------------------------------------

/** Parse the leading number of a grinder setting ("12", "12 / inner 4", "12A"). */
export function parseGrindNumber(setting: string | null | undefined): number | null {
  if (!setting) return null;
  const m = String(setting).trim().match(/^-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** Moves a grinder setting by `steps` (negative = finer). Returns null if the setting isn't numeric. */
export function stepGrind(setting: string | null | undefined, finer: boolean, steps: number, lowerIsFiner = true): string | null {
  const n = parseGrindNumber(setting);
  if (n == null) return null;
  const delta = (finer === lowerIsFiner ? -1 : 1) * steps;
  const next = Math.max(1, n + delta);
  return String(setting).trim().replace(/^-?\d+(\.\d+)?/, trimNumber(next, 1));
}

export interface DialInInput {
  shot: Pick<Shot, 'dose_g' | 'yield_g' | 'time_s' | 'temperature_c' | 'preinfusion_s' | 'grinder_setting' | 'taste_tags' | 'score'>;
  /** The recipe the shot was aiming for. If absent, the shot's own numbers are the baseline. */
  target?: RecipeParams | null;
  prefs?: BrewPreferences;
}

export function recommendNextShot({ shot, target, prefs = DEFAULT_PREFERENCES }: DialInInput): Advice {
  const tags = new Set<TasteTag>(shot.taste_tags ?? []);
  const has = (t: TasteTag) => tags.has(t);

  // Baseline for the next shot = the recipe, but with the grind you ACTUALLY used.
  const base: RecipeParams = target
    ? { ...target, grinder_setting: shot.grinder_setting ?? target.grinder_setting }
    : {
        dose_g: shot.dose_g,
        yield_g: shot.yield_g,
        temperature_c: shot.temperature_c ?? 93,
        time_min_s: prefs.time_min_s,
        time_max_s: prefs.time_max_s,
        preinfusion_min_s: shot.preinfusion_s ?? prefs.preinfusion_min_s,
        preinfusion_max_s: shot.preinfusion_s ?? prefs.preinfusion_max_s,
        grinder_setting: shot.grinder_setting,
      };

  const { time_min_s: tMin, time_max_s: tMax } = base;
  const t = shot.time_s;
  const fast = t < tMin;
  const slow = t > tMax;
  const veryFast = t < tMin - 6;
  const verySlow = t > tMax + 6;
  const timeDesc = fast ? `${t} s is faster than the ${tMin}–${tMax} s target` : slow ? `${t} s is slower than the ${tMin}–${tMax} s target` : `${t} s is within the ${tMin}–${tMax} s target`;

  const checks: string[] = [];
  const deviation = deviations(shot, target);
  if (deviation) checks.push(deviation);

  const temp = base.temperature_c;
  const score = shot.score ?? null;
  const goodFlavour = (has('balanced') || has('sweet') || (score != null && score >= 4)) &&
    !has('sour') && !has('bitter') && !has('astringent') && !has('channeling');

  const mk = (adjustment: Adjustment, diagnosis: Advice['diagnosis'], headline: string, explanation: string, next: RecipeParams, extraChecks: string[] = []): Advice => ({
    adjustment, diagnosis, headline, explanation,
    checks: [...extraChecks, ...checks],
    next,
    promising: adjustment === 'keep' && goodFlavour,
    source: 'engine',
  });

  const grind = (finer: boolean, steps: number) => {
    const moved = stepGrind(base.grinder_setting, finer, steps, prefs.grinder_lower_is_finer);
    return {
      next: { ...base, grinder_setting: moved ?? base.grinder_setting },
      label: moved
        ? `${finer ? 'finer' : 'coarser'}: ${base.grinder_setting} → ${moved}`
        : `${steps} step${steps > 1 ? 's' : ''} ${finer ? 'finer' : 'coarser'}`,
    };
  };

  const puckChecks = [
    'WDT all the way to the bottom of the basket and break up every clump.',
    'Check the coffee bed is level before tamping; let the self-levelling tamper sit flat.',
    'Seat the puck screen flat and make sure the basket is dry before dosing.',
  ];

  // --- 1. Uneven extraction: sour AND bitter, or visible channeling -------------
  if (has('channeling') || (has('sour') && has('bitter'))) {
    return mk('puck_prep', 'uneven', 'Keep the recipe — fix puck prep first',
      `${has('channeling') ? 'Spurting or uneven flow' : 'Sour and bitter in the same shot'} points to channeling: some coffee over-extracts while the rest under-extracts. Changing the grind now would chase the wrong problem. Repeat the same recipe with careful puck prep.`,
      { ...base }, puckChecks);
  }

  // --- 2. Sour ------------------------------------------------------------------
  if (has('sour')) {
    if (fast) {
      const steps = veryFast ? 2 : 1;
      const g = grind(true, steps);
      return mk('grind_finer', 'under', `Grind finer (${g.label})`,
        `Sour and ${timeDesc}: classic under-extraction. Going finer slows the shot and pulls more sweetness. Keep dose, yield and temperature the same.`,
        g.next);
    }
    if (slow) {
      return mk('puck_prep', 'uneven', 'Sour despite a slow shot — check for channeling',
        `${timeDesc}, yet it tastes sour. Slow-but-sour usually means water is channeling through part of the puck (often when the grind is very fine). Don't go finer; repeat with careful puck prep. If it's still sour, go one step coarser.`,
        { ...base }, puckChecks);
    }
    if (temp < MACHINE_TEMP_MAX) {
      return mk('increase_temp', 'under', `Raise temperature to ${temp + 1} °C`,
        `Sour while ${timeDesc} — the flow is fine, so grinding finer would push the time out of range. One degree hotter extracts a little more without changing the flow.`,
        { ...base, temperature_c: temp + 1 },
        ['If the shot looked uneven, fix puck prep before changing anything.']);
    }
    const g = grind(true, 1);
    return mk('grind_finer', 'under', `Grind finer (${g.label})`,
      `Sour while ${timeDesc} and the temperature is already at the machine's top end. One step finer is the next lever.`, g.next);
  }

  // --- 3. Dry / astringent ---------------------------------------------------------
  if (has('astringent')) {
    if (slow) {
      const g = grind(false, 1);
      return mk('grind_coarser', 'over', `Grind coarser (${g.label})`,
        `Dry/astringent and ${timeDesc}: likely over-extraction. One step coarser speeds it up.`, g.next,
        ['Astringency can also come from channeling — keep puck prep consistent.']);
    }
    return mk('puck_prep', 'uneven', 'Check puck prep (possible channeling)',
      `Dryness with ${timeDesc} often comes from channeling rather than overall over-extraction. Repeat the same recipe with careful prep; if it's still dry, go one step coarser.`,
      { ...base }, puckChecks);
  }

  // --- 4. Bitter -------------------------------------------------------------------
  if (has('bitter')) {
    if (slow) {
      const g = grind(false, verySlow ? 2 : 1);
      return mk('grind_coarser', 'over', `Grind coarser (${g.label})`,
        `Bitter and ${timeDesc}: over-extraction. Coarser speeds the shot up. Keep everything else the same.`, g.next);
    }
    if (fast) {
      return mk('puck_prep', 'uneven', 'Bitter but fast — check for channeling',
        `${timeDesc} yet bitter: a fast bitter shot usually means channeling (water rushing through a crack and over-extracting that part). Repeat with careful puck prep before changing grind.`,
        { ...base }, puckChecks);
    }
    if (temp > MACHINE_TEMP_MIN) {
      return mk('decrease_temp', 'over', `Lower temperature to ${temp - 1} °C`,
        `Bitter while ${timeDesc}. The flow is right, so instead of changing grind, one degree cooler reduces harsh extraction.`,
        { ...base, temperature_c: temp - 1 });
    }
    const g = grind(false, 1);
    return mk('grind_coarser', 'over', `Grind coarser (${g.label})`, `Bitter and the temperature is already low; one step coarser is next.`, g.next);
  }

  // --- 5. Thin / watery --------------------------------------------------------------
  if (has('thin')) {
    if (fast) {
      const g = grind(true, veryFast ? 2 : 1);
      return mk('grind_finer', 'under', `Grind finer (${g.label})`,
        `Thin and ${timeDesc}: the water is passing too quickly. Finer adds body and sweetness.`, g.next);
    }
    const newYield = Math.max(roundTo(base.dose_g * 1.5, 0.5), base.yield_g - 2);
    return mk('decrease_yield', 'strength', `Reduce yield to ${trimNumber(newYield)} g`,
      `Thin but ${timeDesc}: extraction is fine, the shot is just diluted. A shorter ratio (${formatRatio(base.dose_g, newYield)}) gives more body.`,
      { ...base, yield_g: newYield });
  }

  // --- 6. Too intense / heavy ----------------------------------------------------------
  if (has('heavy')) {
    const newYield = base.yield_g + 2;
    return mk('increase_yield', 'strength', `Increase yield to ${trimNumber(newYield)} g`,
      `Good but heavy: a slightly longer ratio (${formatRatio(base.dose_g, newYield)}) lightens the cup and often opens up sweetness. Keep the grind — expect a couple of seconds longer.`,
      { ...base, yield_g: newYield });
  }

  // --- 7. Good but too acidic ------------------------------------------------------------
  if (has('too acidic')) {
    if (temp < MACHINE_TEMP_MAX) {
      return mk('increase_temp', 'balance', `Raise temperature to ${temp + 1} °C`,
        'Good flavour but the acidity is a bit forward. One degree hotter rounds acidity off without changing flow. If that overshoots, try +2 g yield instead.',
        { ...base, temperature_c: temp + 1 });
    }
    const newYield = base.yield_g + 2;
    return mk('increase_yield', 'balance', `Increase yield to ${trimNumber(newYield)} g`,
      'Good flavour but acidity is forward and the temperature is already high; 2 g more yield should balance it.',
      { ...base, yield_g: newYield });
  }

  // --- 8. No faults -----------------------------------------------------------------------
  if (goodFlavour) {
    const timeNote = fast || slow ? ` ${timeDesc}, but taste is what matters — no need to chase the clock.` : '';
    return mk('keep', 'on-target', 'Keep this recipe — promising',
      `Tastes good with no faults.${timeNote} Repeat it to confirm, or change one variable at a time if you want to explore.`,
      { ...base });
  }

  if (fast || slow) {
    const g = grind(fast, (fast && veryFast) || (slow && verySlow) ? 2 : 1);
    return mk(fast ? 'grind_finer' : 'grind_coarser', 'time-only', `Grind ${g.label}`,
      `No taste faults recorded, but ${timeDesc}. Bring the time into range with grind first, then judge the taste.`, g.next,
      ['Add tasting notes next time — taste beats the timer.']);
  }

  return mk('keep', 'on-target', 'Keep the recipe and record how it tastes',
    `${timeDesc[0].toUpperCase()}${timeDesc.slice(1)}. Without tasting notes there's nothing to correct yet — repeat it and record sour/bitter/sweet so the next suggestion is specific.`,
    { ...base });
}

function deviations(shot: DialInInput['shot'], target?: RecipeParams | null): string | null {
  if (!target) return null;
  const parts: string[] = [];
  if (Math.abs(shot.dose_g - target.dose_g) > 0.3) parts.push(`dose was ${trimNumber(shot.dose_g)} g vs ${trimNumber(target.dose_g)} g planned`);
  if (Math.abs(shot.yield_g - target.yield_g) > 1.5) parts.push(`yield was ${trimNumber(shot.yield_g)} g vs ${trimNumber(target.yield_g)} g planned`);
  if (shot.temperature_c != null && Math.abs(shot.temperature_c - target.temperature_c) >= 1) parts.push(`temperature was ${shot.temperature_c} °C vs ${target.temperature_c} °C planned`);
  if (!parts.length) return null;
  return `This shot differed from the recipe (${parts.join('; ')}). Hit the planned numbers next time so the comparison is fair.`;
}

/** Which of the "major" variables differ between two parameter sets. */
export function changedVariables(a: RecipeParams, b: RecipeParams): Array<'dose' | 'yield' | 'temperature' | 'grind' | 'preinfusion'> {
  const out: Array<'dose' | 'yield' | 'temperature' | 'grind' | 'preinfusion'> = [];
  if (Math.abs(a.dose_g - b.dose_g) > 0.05) out.push('dose');
  if (Math.abs(a.yield_g - b.yield_g) > 0.05) out.push('yield');
  if (Math.abs(a.temperature_c - b.temperature_c) > 0.05) out.push('temperature');
  if ((a.grinder_setting ?? '').trim() !== (b.grinder_setting ?? '').trim()) out.push('grind');
  if ((a.preinfusion_min_s ?? null) !== (b.preinfusion_min_s ?? null) || (a.preinfusion_max_s ?? null) !== (b.preinfusion_max_s ?? null)) out.push('preinfusion');
  return out;
}

/** Ranks shots: score first, then most recent. */
export function bestShot<T extends Pick<Shot, 'score' | 'pulled_at'>>(shots: T[]): T | null {
  const rated = shots.filter((s) => s.score != null);
  if (!rated.length) return null;
  return [...rated].sort((a, b) => (b.score! - a.score!) || b.pulled_at.localeCompare(a.pulled_at))[0];
}

export { ratioOf };
