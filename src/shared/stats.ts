// Derived statistics for history and comparisons (spec §4.F). Computed from recorded
// shots and recipes on read; nothing here is stored.

import type { Coffee, Recipe, RecipeParams, Shot, TasteTag } from './types';
import { roastAgeDays } from './ratio';

export const FLAVOURS = ['chocolate', 'fruity', 'nutty', 'caramel'] as const satisfies readonly TasteTag[];
export type Flavour = (typeof FLAVOURS)[number];

/** Planned (recipe) vs actual (its shots). */
export interface RecipeStats {
  recipe_id: number;
  version: number;
  planned: RecipeParams;
  shots: number;
  scored: number;
  avg_score: number | null;
  avg_dose: number | null;
  avg_yield: number | null;
  avg_time: number | null;
  /** Share of shots whose time landed in the recipe's window. */
  on_target: number | null;
}

export interface CoffeeStats {
  shots: number;
  scored: number;
  avg_score: number | null;
  best_score: number | null;
  /** Share of tasted shots (any taste tag) that had each flavour note. */
  flavour_share: Record<Flavour, number> | null;
  tasted_shots: number;
  /** Share of shots that were good: sweet or balanced, or scored 4+, with no fault tags. */
  good_share: number | null;
  recipes: RecipeStats[];
  most_successful_recipe: RecipeStats | null;
  first_shot_roast_age: number | null;
  last_shot_roast_age: number | null;
}

const FAULTS: TasteTag[] = ['sour', 'bitter', 'astringent', 'channeling', 'thin'];
const avg = (xs: number[]) => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length, 1) : null);
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

export function isGoodShot(s: Pick<Shot, 'taste_tags' | 'score'>): boolean {
  if (s.taste_tags.some((t) => FAULTS.includes(t))) return false;
  return s.taste_tags.includes('sweet') || s.taste_tags.includes('balanced') || (s.score ?? 0) >= 4;
}

export function recipeStats(recipe: Recipe, shots: Shot[]): RecipeStats {
  const mine = shots.filter((s) => s.recipe_id === recipe.id);
  const scores = mine.filter((s) => s.score != null).map((s) => s.score!);
  const inWindow = mine.filter((s) => s.time_s >= recipe.time_min_s && s.time_s <= recipe.time_max_s).length;
  return {
    recipe_id: recipe.id,
    version: recipe.version,
    planned: {
      dose_g: recipe.dose_g, yield_g: recipe.yield_g, temperature_c: recipe.temperature_c, time_min_s: recipe.time_min_s, time_max_s: recipe.time_max_s,
      preinfusion_min_s: recipe.preinfusion_min_s, preinfusion_max_s: recipe.preinfusion_max_s, grind_setting: recipe.grind_setting, grind_inner: recipe.grind_inner,
    },
    shots: mine.length,
    scored: scores.length,
    avg_score: avg(scores),
    avg_dose: avg(mine.map((s) => s.dose_g)),
    avg_yield: avg(mine.map((s) => s.yield_g)),
    avg_time: avg(mine.map((s) => s.time_s)),
    on_target: mine.length ? round(inWindow / mine.length, 2) : null,
  };
}

export function coffeeStats(coffee: Pick<Coffee, 'roast_date'>, shots: Shot[], recipes: Recipe[]): CoffeeStats {
  const scores = shots.filter((s) => s.score != null).map((s) => s.score!);
  const tasted = shots.filter((s) => s.taste_tags.length > 0);
  const flavour_share = tasted.length
    ? Object.fromEntries(FLAVOURS.map((f) => [f, round(tasted.filter((s) => s.taste_tags.includes(f)).length / tasted.length, 2)])) as Record<Flavour, number>
    : null;
  const judged = shots.filter((s) => s.taste_tags.length || s.score != null);
  const perRecipe = recipes.map((r) => recipeStats(r, shots));
  const ranked = perRecipe.filter((r) => r.avg_score != null)
    .sort((a, b) => (b.avg_score! - a.avg_score!) || (b.scored - a.scored) || (b.version - a.version));
  const byTime = [...shots].sort((a, b) => a.pulled_at.localeCompare(b.pulled_at));
  return {
    shots: shots.length,
    scored: scores.length,
    avg_score: avg(scores),
    best_score: scores.length ? Math.max(...scores) : null,
    flavour_share,
    tasted_shots: tasted.length,
    good_share: judged.length ? round(judged.filter(isGoodShot).length / judged.length, 2) : null,
    recipes: perRecipe,
    most_successful_recipe: ranked[0] ?? null,
    first_shot_roast_age: byTime.length ? roastAgeDays(coffee.roast_date, byTime[0].pulled_at) : null,
    last_shot_roast_age: byTime.length ? roastAgeDays(coffee.roast_date, byTime.at(-1)!.pulled_at) : null,
  };
}

export interface CompareHighlight { coffee_id: number; value: number; basis: number }

/** Leaders across compared coffees; null when there's no evidence (no shots tasted / scored). */
export function compareHighlights(items: Array<{ coffee_id: number; stats: CoffeeStats }>) {
  const leader = (pick: (s: CoffeeStats) => number | null, basis: (s: CoffeeStats) => number): CompareHighlight | null => {
    let best: CompareHighlight | null = null;
    for (const { coffee_id, stats } of items) {
      const v = pick(stats);
      if (v == null || v <= 0) continue;
      if (!best || v > best.value || (v === best.value && basis(stats) > best.basis)) best = { coffee_id, value: v, basis: basis(stats) };
    }
    return best;
  };
  return {
    chocolate: leader((s) => s.flavour_share?.chocolate ?? null, (s) => s.tasted_shots),
    fruity: leader((s) => s.flavour_share?.fruity ?? null, (s) => s.tasted_shots),
    best_avg_score: leader((s) => s.avg_score, (s) => s.scored),
    most_successful_recipe: leader((s) => s.most_successful_recipe?.avg_score ?? null, (s) => s.most_successful_recipe?.scored ?? 0),
  };
}
