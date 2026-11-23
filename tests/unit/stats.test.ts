import { describe, expect, it } from 'vitest';
import { coffeeStats, compareHighlights, isGoodShot, recipeStats } from '../../src/shared/stats';
import { toCsv } from '../../src/shared/csv';
import type { Recipe, Shot, TasteTag } from '../../src/shared/types';

const recipe = (id: number, version: number, over: Partial<Recipe> = {}): Recipe => ({
  id, coffee_id: 1, version, dose_g: 20, yield_g: 40, ratio: 2, temperature_c: 93, time_min_s: 28, time_max_s: 32,
  preinfusion_min_s: 5, preinfusion_max_s: 8, grind_setting: 14, grind_inner: null, rationale: null, source: 'engine',
  status: 'active', promising: false, stated_ratio: null, based_on_shot_id: null, created_at: '2026-11-01T00:00:00Z', ...over,
});
let n = 0;
const shot = (recipe_id: number | null, time_s: number, tags: TasteTag[] = [], score: number | null = null, day = 1): Shot => ({
  id: ++n, coffee_id: 1, recipe_id, pulled_at: `2026-11-${String(day).padStart(2, '0')}T08:00:00Z`, dose_g: 20, yield_g: 40, ratio: 2,
  time_s, temperature_c: 93, preinfusion_s: 6, grinder_model: null, grind_setting: 14, grind_inner: null, basket: null,
  taste_tags: tags, score, feedback: null, notes: null, photo_image_id: null, advice: null, created_at: '',
});

describe('recipe stats: planned vs actual', () => {
  it('averages the shots pulled on a recipe and how often they hit the window', () => {
    const r = recipe(1, 1);
    const s = recipeStats(r, [shot(1, 24, ['sour'], 2), shot(1, 30, ['sweet'], 4), shot(2, 29)]);
    expect(s).toMatchObject({ shots: 2, scored: 2, avg_score: 3, avg_time: 27, on_target: 0.5, planned: { yield_g: 40, time_min_s: 28 } });
  });
});

describe('coffee stats', () => {
  const r1 = recipe(1, 1);
  const r2 = recipe(2, 2, { grind_setting: 13 });
  const shots = [shot(1, 24, ['sour'], 2, 3), shot(2, 29, ['sweet', 'chocolate'], 5, 5), shot(2, 30, ['balanced', 'chocolate', 'nutty'], 4, 6), shot(2, 31, ['bitter'], 2, 7)];
  const st = coffeeStats({ roast_date: '2026-11-01' }, shots, [r1, r2]);

  it('summarises scores, flavours and good shots', () => {
    expect(st).toMatchObject({ shots: 4, scored: 4, avg_score: 3.3, best_score: 5, tasted_shots: 4, good_share: 0.5 });
    expect(st.flavour_share).toEqual({ chocolate: 0.5, fruity: 0, nutty: 0.25, caramel: 0 });
  });
  it('finds the most successful recipe by average score', () => {
    expect(st.most_successful_recipe).toMatchObject({ version: 2, avg_score: 3.7, shots: 3 });
  });
  it('tracks roast age across the shots', () => {
    expect(st).toMatchObject({ first_shot_roast_age: 2, last_shot_roast_age: 6 });
  });
  it('is empty-safe', () => {
    expect(coffeeStats({ roast_date: null }, [], [])).toMatchObject({ shots: 0, avg_score: null, flavour_share: null, good_share: null, most_successful_recipe: null, first_shot_roast_age: null });
  });
  it('good shot = sweet/balanced or 4+, and no faults', () => {
    expect(isGoodShot({ taste_tags: ['sweet', 'sour'], score: 5 })).toBe(false);
    expect(isGoodShot({ taste_tags: [], score: 4 })).toBe(true);
    expect(isGoodShot({ taste_tags: ['chocolate'], score: 3 })).toBe(false);
  });
});

describe('compare highlights', () => {
  it('picks leaders only where there is evidence', () => {
    const a = coffeeStats({ roast_date: null }, [shot(null, 30, ['chocolate', 'sweet'], 4), shot(null, 30, ['fruity'], 3)], []);
    const b = coffeeStats({ roast_date: null }, [shot(null, 30, ['chocolate'], 5)], []);
    const c = coffeeStats({ roast_date: null }, [], []);
    const h = compareHighlights([{ coffee_id: 1, stats: a }, { coffee_id: 2, stats: b }, { coffee_id: 3, stats: c }]);
    expect(h.chocolate).toEqual({ coffee_id: 2, value: 1, basis: 1 });
    expect(h.fruity).toEqual({ coffee_id: 1, value: 0.5, basis: 2 });
    expect(h.best_avg_score?.coffee_id).toBe(2);
    expect(h.most_successful_recipe).toBeNull();
  });
});

describe('csv', () => {
  it('quotes when needed and joins arrays', () => {
    expect(toCsv(['a', 'b', 'c'], [['x, y', 'say "hi"', ['sour', 'bitter']], [null, 2, 'plain']]))
      .toBe('a,b,c\r\n"x, y","say ""hi""",sour; bitter\r\n,2,plain\r\n');
  });
});
