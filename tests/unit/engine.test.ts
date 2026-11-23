import { describe, expect, it } from 'vitest';
import {
  bestShot, changedVariables, recipeBoundsProblems, recommendNextShot, stepGrind, suggestInitialRecipe, validateAiAdvice,
} from '../../src/shared/engine';
import type { Coffee, RecipeParams, ShotFields } from '../../src/shared/types';

const recipe: RecipeParams = {
  dose_g: 20, yield_g: 40, temperature_c: 93, time_min_s: 28, time_max_s: 32,
  preinfusion_min_s: 5, preinfusion_max_s: 8, grind_setting: 14, grind_inner: null,
};

const shot = (over: Partial<ShotFields>): ShotFields => ({
  dose_g: 20, yield_g: 40, time_s: 30, temperature_c: 93, preinfusion_s: 6,
  grind_setting: 14, grind_inner: null, taste_tags: [], score: null, ...over,
});

const coffee = (over: Partial<Coffee> = {}) => ({
  roast_level: null, roast_date: null, processing: null, tasting_notes: [], field_sources: {}, ...over,
}) as Pick<Coffee, 'roast_level' | 'roast_date' | 'processing' | 'tasting_notes' | 'field_sources'>;

const advise = (over: Partial<ShotFields>, target: RecipeParams | null = recipe) => recommendNextShot({ shot: shot(over), target });

describe('starting recipe (spec §7)', () => {
  it.each([
    ['light', 94, 44, 28, 32],
    ['light-medium', 94, 42, 28, 32],
    ['medium', 93, 40, 28, 32],
    ['medium-dark', 92, 40, 27, 30],
    ['dark', 91, 40, 26, 30],
  ] as const)('%s roast → %d °C, %d g, %d–%d s', (roast, temp, yld, tmin, tmax) => {
    const { params } = suggestInitialRecipe(coffee({ roast_level: roast }));
    expect(params).toMatchObject({ dose_g: 20, yield_g: yld, temperature_c: temp, time_min_s: tmin, time_max_s: tmax, preinfusion_min_s: 5, preinfusion_max_s: 8 });
  });

  it('unknown roast uses medium defaults and asks for more info', () => {
    const s = suggestInitialRecipe(coffee());
    expect(s.params).toMatchObject({ yield_g: 40, temperature_c: 93 });
    expect(s.rationale).toMatch(/Roast level unknown/);
  });

  it('says when the roast level is only a visual estimate', () => {
    const s = suggestInitialRecipe(coffee({ roast_level: 'medium-dark', field_sources: { roast_level: 'visual' } }));
    expect(s.rationale).toMatch(/visual estimate/);
  });

  it('natural process does not change the ratio (not deterministic)', () => {
    const plain = suggestInitialRecipe(coffee({ roast_level: 'medium' }));
    const natural = suggestInitialRecipe(coffee({ roast_level: 'medium', processing: 'Natural' }));
    expect(natural.params).toEqual(plain.params);
    expect(natural.rationale).toMatch(/not every natural/i);
  });

  it('starts from your best shot (score ≥ 4) when there is one', () => {
    const s = suggestInitialRecipe(coffee({ roast_level: 'light' }), {
      shotsThisCoffee: [
        { score: 3, pulled_at: '2026-11-01T08:00:00Z', dose_g: 20, yield_g: 40, time_s: 25, temperature_c: 93, preinfusion_s: 6, grind_setting: 15, grind_inner: null },
        { score: 5, pulled_at: '2026-11-02T08:00:00Z', dose_g: 20, yield_g: 42, time_s: 30, temperature_c: 94, preinfusion_s: 7, grind_setting: 13, grind_inner: 4 },
      ],
    });
    expect(s.params).toMatchObject({ yield_g: 42, temperature_c: 94, time_min_s: 28, time_max_s: 32, grind_setting: 13, grind_inner: 4, preinfusion_min_s: 7 });
    expect(s.rationale).toMatch(/best shot/);
  });

  it('only hints at a grind from another coffee, never fills it in', () => {
    const s = suggestInitialRecipe(coffee({ roast_level: 'medium' }), { lastShotAnyCoffee: { grind_setting: 12, coffee_name: 'Lazzio Brazil' } });
    expect(s.params.grind_setting).toBeNull();
    expect(s.rationale).toMatch(/Lazzio Brazil.*12/);
  });

  it('uses the last grind on this coffee', () => {
    const s = suggestInitialRecipe(coffee({ roast_level: 'medium' }), {
      shotsThisCoffee: [{ score: 2, pulled_at: '2026-11-02T08:00:00Z', dose_g: 20, yield_g: 40, time_s: 22, temperature_c: 93, preinfusion_s: 6, grind_setting: 11, grind_inner: null }],
    });
    expect(s.params.grind_setting).toBe(11);
  });

  it('mentions roast age when very fresh or old', () => {
    expect(suggestInitialRecipe(coffee({ roast_date: '2026-11-20' }), { now: new Date('2026-11-22T10:00:00') }).rationale).toMatch(/very fresh/);
    expect(suggestInitialRecipe(coffee({ roast_date: '2026-09-01' }), { now: new Date('2026-11-22T10:00:00') }).rationale).toMatch(/older beans/);
  });
});

describe('dial-in decision table (spec §8.3)', () => {
  it('handover example: 24 s and a little sour → grind finer, nothing else changes', () => {
    const a = advise({ time_s: 24, taste_tags: ['sour'] });
    expect(a).toMatchObject({ rule: 2, adjustment: 'grind_finer', diagnosis: 'under' });
    expect(a.next).toEqual({ ...recipe, grind_setting: 13 });
    expect(a.headline).toBe('Grind finer: 14 → 13');
  });

  it('handover example: 29 s, much sweeter, chocolate → keep, promising', () => {
    const a = advise({ time_s: 29, taste_tags: ['sweet', 'chocolate'], grind_setting: 13 });
    expect(a).toMatchObject({ rule: 14, adjustment: 'keep', promising: true });
    expect(a.next).toEqual({ ...recipe, grind_setting: 13 });
  });

  it('rule 1: channeling → puck prep, no change', () => {
    const a = advise({ time_s: 22, taste_tags: ['channeling', 'sour'] });
    expect(a).toMatchObject({ rule: 1, adjustment: 'puck_prep' });
    expect(a.next).toEqual(recipe);
  });
  it('rule 1: sour + bitter together → puck prep', () => {
    expect(advise({ taste_tags: ['sour', 'bitter'] })).toMatchObject({ rule: 1, adjustment: 'puck_prep' });
  });
  it('rule 2: sour and very fast → 2 steps finer', () => {
    expect(advise({ time_s: 18, taste_tags: ['sour'] }).next.grind_setting).toBe(12);
  });
  it('rule 3: sour but slow → puck prep, not finer', () => {
    const a = advise({ time_s: 36, taste_tags: ['sour'] });
    expect(a).toMatchObject({ rule: 3, adjustment: 'puck_prep' });
    expect(a.next.grind_setting).toBe(14);
  });
  it('rule 4: sour within the window → +1 °C', () => {
    const a = advise({ time_s: 30, taste_tags: ['sour'] });
    expect(a).toMatchObject({ rule: 4, adjustment: 'increase_temp' });
    expect(a.next).toEqual({ ...recipe, temperature_c: 94 });
  });
  it('rule 4: sour within the window at 96 °C → grind finer', () => {
    const a = recommendNextShot({ shot: shot({ taste_tags: ['sour'], temperature_c: 96 }), target: { ...recipe, temperature_c: 96 } });
    expect(a).toMatchObject({ rule: 4, adjustment: 'grind_finer' });
    expect(a.next.temperature_c).toBe(96);
  });
  it('rule 5: dry and slow → coarser', () => {
    expect(advise({ time_s: 35, taste_tags: ['astringent'] })).toMatchObject({ rule: 5, adjustment: 'grind_coarser', next: { grind_setting: 15 } });
  });
  it('rule 6: dry in range → puck prep', () => {
    expect(advise({ taste_tags: ['astringent'] })).toMatchObject({ rule: 6, adjustment: 'puck_prep' });
  });
  it('rule 7: bitter and very slow → 2 steps coarser', () => {
    expect(advise({ time_s: 40, taste_tags: ['bitter'] })).toMatchObject({ rule: 7, adjustment: 'grind_coarser', next: { grind_setting: 16 } });
  });
  it('rule 8: bitter but fast → puck prep', () => {
    expect(advise({ time_s: 22, taste_tags: ['bitter'] })).toMatchObject({ rule: 8, adjustment: 'puck_prep' });
  });
  it('rule 9: bitter in range → −1 °C', () => {
    expect(advise({ taste_tags: ['bitter'] })).toMatchObject({ rule: 9, adjustment: 'decrease_temp', next: { temperature_c: 92 } });
  });
  it('rule 10: thin and fast → finer', () => {
    expect(advise({ time_s: 25, taste_tags: ['thin'] })).toMatchObject({ rule: 10, adjustment: 'grind_finer', next: { grind_setting: 13 } });
  });
  it('rule 11: thin in range → −2 g yield (1:1.9)', () => {
    const a = advise({ taste_tags: ['thin'] });
    expect(a).toMatchObject({ rule: 11, adjustment: 'decrease_yield', next: { yield_g: 38 } });
    expect(a.headline).toBe('Reduce yield to 38 g');
  });
  it('rule 11: never below 1:1.5', () => {
    const a = recommendNextShot({ shot: shot({ yield_g: 30, taste_tags: ['thin'] }), target: { ...recipe, yield_g: 30 } });
    expect(a.next.yield_g).toBe(30);
    expect(a.adjustment).toBe('keep');
  });
  it('rule 12: heavy → +2 g yield (Manna: try 42 g)', () => {
    expect(advise({ taste_tags: ['heavy', 'chocolate'] })).toMatchObject({ rule: 12, adjustment: 'increase_yield', next: { yield_g: 42 } });
  });
  it('rule 13: good but too acidic → +1 °C', () => {
    expect(advise({ taste_tags: ['too acidic', 'fruity'] })).toMatchObject({ rule: 13, adjustment: 'increase_temp', next: { temperature_c: 94 } });
  });
  it('rule 14: score ≥ 4 with a slightly slow time → keep, no clock chasing', () => {
    const a = advise({ time_s: 34, score: 4 });
    expect(a).toMatchObject({ rule: 14, adjustment: 'keep', promising: true });
    expect(a.explanation).toMatch(/no need to chase the clock/);
  });
  it('rule 15: no taste info and fast → grind toward the window', () => {
    expect(advise({ time_s: 25 })).toMatchObject({ rule: 15, adjustment: 'grind_finer', diagnosis: 'time-only', next: { grind_setting: 13 } });
  });
  it('rule 16: no taste info, in range → keep and ask for notes', () => {
    expect(advise({ time_s: 30 })).toMatchObject({ rule: 16, adjustment: 'keep', promising: false });
  });

  it('changes exactly one variable (or none) for every rule', () => {
    const cases: Array<Partial<ShotFields>> = [
      { time_s: 24, taste_tags: ['sour'] }, { time_s: 36, taste_tags: ['sour'] }, { taste_tags: ['sour'] },
      { time_s: 35, taste_tags: ['astringent'] }, { taste_tags: ['astringent'] }, { time_s: 40, taste_tags: ['bitter'] },
      { time_s: 22, taste_tags: ['bitter'] }, { taste_tags: ['bitter'] }, { time_s: 25, taste_tags: ['thin'] },
      { taste_tags: ['thin'] }, { taste_tags: ['heavy'] }, { taste_tags: ['too acidic'] }, { taste_tags: ['balanced'] },
      { time_s: 20 }, { time_s: 30 }, { taste_tags: ['channeling'] },
    ];
    for (const c of cases) {
      const a = advise(c);
      expect(changedVariables({ ...recipe, grind_setting: c.grind_setting ?? 14 }, a.next).length).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the grind actually used, not the planned one', () => {
    const a = advise({ time_s: 24, taste_tags: ['sour'], grind_setting: 12 });
    expect(a.next.grind_setting).toBe(11);
  });

  it('notes deviations from the recipe', () => {
    const a = advise({ yield_g: 45, taste_tags: ['balanced'] });
    expect(a.checks.join(' ')).toMatch(/yield 45 g vs 40 g planned/);
  });

  it('works without a recipe (baseline = the shot, window = preferences)', () => {
    const a = recommendNextShot({ shot: shot({ dose_g: 19.7, yield_g: 39.5, time_s: 24, temperature_c: 90, grind_setting: null, taste_tags: ['sour'] }) });
    expect(a).toMatchObject({ adjustment: 'grind_finer', next: { dose_g: 19.7, yield_g: 39.5, temperature_c: 90, time_min_s: 28 } });
    expect(a.headline).toBe('Grind 1 step finer');
  });

  it('clamps the temperature to the machine range', () => {
    const a = recommendNextShot({ shot: shot({ taste_tags: ['bitter'], temperature_c: 86 }), target: { ...recipe, temperature_c: 86 } });
    expect(a.next.temperature_c).toBe(86);
    expect(a.adjustment).toBe('grind_coarser');
  });
});

describe('grind stepping', () => {
  it('lower = finer on the Smart Grinder Pro, clamped to 1–60', () => {
    expect(stepGrind(14, true, 1)).toBe(13);
    expect(stepGrind(14, false, 2)).toBe(16);
    expect(stepGrind(1, true, 2)).toBe(1);
    expect(stepGrind(60, false, 1)).toBe(60);
    expect(stepGrind(null, true, 1)).toBeNull();
  });
});

describe('AI advice validation (rule R6)', () => {
  const engine = advise({ time_s: 24, taste_tags: ['sour'] });
  const base = { ...recipe };
  it('accepts a single-variable change', () => {
    const r = validateAiAdvice(engine, base, { ...engine, adjustment: 'increase_temp', next: { ...base, temperature_c: 94 } });
    expect(r.accepted).toBe(true);
    expect(r.advice).toMatchObject({ source: 'ai', engine_adjustment: 'grind_finer' });
  });
  it('rejects two changes and falls back to the engine', () => {
    const r = validateAiAdvice(engine, base, { ...engine, next: { ...base, temperature_c: 94, grind_setting: 13 } });
    expect(r.accepted).toBe(false);
    expect(r.advice).toBe(engine);
  });
  it('rejects out-of-bounds values', () => {
    expect(validateAiAdvice(engine, base, { ...engine, next: { ...base, temperature_c: 99 } }).accepted).toBe(false);
    expect(recipeBoundsProblems({ ...base, yield_g: 70 })).not.toHaveLength(0);
    expect(recipeBoundsProblems({ ...base, temperature_c: 93.5 })).not.toHaveLength(0);
  });
});

describe('best shot', () => {
  it('highest score, ties → most recent', () => {
    const shots = [
      { id: 1, score: 4, pulled_at: '2026-11-01' }, { id: 2, score: 5, pulled_at: '2026-11-02' },
      { id: 3, score: 5, pulled_at: '2026-11-03' }, { id: 4, score: null, pulled_at: '2026-11-04' },
    ];
    expect(bestShot(shots)?.id).toBe(3);
    expect(bestShot([{ id: 1, score: null, pulled_at: 'x' }])).toBeNull();
  });
});
