import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../app';
import { body, idParam, notFound } from '../http';
import { adviceRequestSchema, createShotSchema, updateShotSchema } from '../schemas';
import {
  activateRecipe, currentRecipe, getCoffee, getLimits, getPreferences, getRecipe, getShot, grinderModel, insertRecipe,
  listRecipes, listShots, nowIso, recipeParams, toShot,
} from '../db';
import { changedVariables, recommendNextShot } from '../../shared/engine';
import type { Advice, Recipe, Shot } from '../../shared/types';
import { reviewAdviceWithAi } from '../ai/service';

export const shots = new Hono<AppEnv>();

const SHOT_COLUMNS = [
  'coffee_id', 'recipe_id', 'pulled_at', 'dose_g', 'yield_g', 'time_s', 'temperature_c', 'preinfusion_s', 'grinder_model',
  'grind_setting', 'grind_inner', 'basket', 'taste_tags', 'score', 'feedback', 'notes', 'photo_image_id',
] as const;
const ADVICE_INPUTS = ['dose_g', 'yield_g', 'time_s', 'temperature_c', 'preinfusion_s', 'grind_setting', 'grind_inner', 'taste_tags', 'score', 'recipe_id'];

const dbValue = (k: string, v: unknown) => (k === 'taste_tags' ? JSON.stringify(v ?? []) : v ?? null);

async function engineAdvice(db: D1Database, shot: Shot, recipe: Recipe | null): Promise<Advice> {
  const [prefs, limits] = await Promise.all([getPreferences(db), getLimits(db)]);
  return recommendNextShot({ shot, target: recipe ? recipeParams(recipe) : null, prefs, limits });
}

shots.get('/', async (c) => {
  const unassigned = c.req.query('unassigned') === '1';
  const sql = unassigned
    ? 'SELECT * FROM shots WHERE coffee_id IS NULL ORDER BY pulled_at DESC'
    : 'SELECT * FROM shots ORDER BY pulled_at DESC LIMIT 100';
  const { results } = await c.env.DB.prepare(sql).all();
  return c.json(results.map(toShot));
});

/** Log a shot. Returns the saved shot and the engine's advice for the next one. */
shots.post('/', async (c) => {
  const input = await body(c, createShotSchema);
  const db = c.env.DB;
  const coffee = await getCoffee(db, input.coffee_id);
  if (!coffee) notFound('Coffee');

  // Which recipe was this shot aiming for? Explicit, else the coffee's current recipe.
  let recipe: Recipe | null = null;
  if (input.recipe_id != null) {
    recipe = await getRecipe(db, input.recipe_id);
    if (!recipe || recipe.coffee_id !== coffee.id) throw new HTTPException(400, { message: 'recipe_id does not belong to this coffee' });
  } else {
    recipe = currentRecipe(await listRecipes(db, coffee.id));
  }

  const values: Record<string, unknown> = {
    ...input,
    recipe_id: recipe?.id ?? null,
    pulled_at: input.pulled_at ?? nowIso(),
    temperature_c: input.temperature_c ?? recipe?.temperature_c ?? null,
    grinder_model: await grinderModel(db),
    taste_tags: input.taste_tags ?? [],
  };
  const draft = { ...values, score: values.score ?? null, preinfusion_s: values.preinfusion_s ?? null, grind_setting: values.grind_setting ?? null, grind_inner: values.grind_inner ?? null } as unknown as Shot;
  const advice = await engineAdvice(db, draft, recipe);

  const cols = [...SHOT_COLUMNS];
  const row = await db.prepare(
    `INSERT INTO shots (${cols.join(', ')}, advice) VALUES (${cols.map(() => '?').join(', ')}, ?) RETURNING *`,
  ).bind(...cols.map((k) => dbValue(k, values[k])), JSON.stringify(advice)).first();
  const shot = toShot(row!);

  // Using a suggested recipe makes it the active one; a good "keep" marks it promising.
  const writes: D1PreparedStatement[] = [];
  if (recipe && advice.promising) writes.push(db.prepare('UPDATE recipes SET promising = 1 WHERE id = ?').bind(recipe.id));
  writes.push(db.prepare(`UPDATE coffees SET updated_at = ?${input.mark_active ? ", status = 'active'" : ''} WHERE id = ?`).bind(nowIso(), coffee.id));
  await db.batch(writes);
  if (recipe && recipe.status === 'suggested' && recipe.temperature_c != null) await activateRecipe(db, recipe);

  return c.json({ shot, advice }, 201);
});

shots.get('/:id', async (c) => {
  const shot = await getShot(c.env.DB, idParam(c));
  if (!shot) notFound('Shot');
  return c.json(shot);
});

/** Edit a shot's own fields (never touches recipes, rule R3). Advice is recomputed if inputs changed. */
shots.patch('/:id', async (c) => {
  const db = c.env.DB;
  const shot = await getShot(db, idParam(c));
  if (!shot) notFound('Shot');
  const changes = await body(c, updateShotSchema);
  if (changes.coffee_id != null && !(await getCoffee(db, changes.coffee_id))) notFound('Coffee');

  const merged = { ...shot, ...changes } as Shot;
  let advice = shot.advice;
  if (ADVICE_INPUTS.some((k) => k in changes) || (changes.coffee_id != null && shot.coffee_id == null)) {
    const recipe = merged.recipe_id != null ? await getRecipe(db, merged.recipe_id) : null;
    advice = await engineAdvice(db, merged, recipe);
  }
  const cols = SHOT_COLUMNS.filter((k) => k in changes);
  const row = await db.prepare(`UPDATE shots SET ${[...cols.map((k) => `${k} = ?`), 'advice = ?'].join(', ')} WHERE id = ? RETURNING *`)
    .bind(...cols.map((k) => dbValue(k, (changes as Record<string, unknown>)[k])), JSON.stringify(advice), shot.id).first();
  return c.json(toShot(row!));
});

/** Recompute advice; with use_ai the AI reviews the engine's call (validated, rule R6). */
shots.post('/:id/advice', async (c) => {
  const db = c.env.DB;
  const shot = await getShot(db, idParam(c));
  if (!shot) notFound('Shot');
  const { use_ai } = await body(c, adviceRequestSchema);
  const recipe = shot.recipe_id != null ? await getRecipe(db, shot.recipe_id) : null;
  let advice = await engineAdvice(db, shot, recipe);
  let ai_note: string | undefined;
  if (use_ai) {
    if (shot.coffee_id == null) throw new HTTPException(400, { message: 'Assign the shot to a coffee first.' });
    const coffee = (await getCoffee(db, shot.coffee_id))!;
    const history = (await listShots(db, coffee.id)).slice(0, 10);
    const result = await reviewAdviceWithAi(c.env, { coffee, recipe, shot, history, engine: advice, limits: await getLimits(db) });
    advice = result.advice;
    ai_note = result.note;
  }
  await db.prepare('UPDATE shots SET advice = ? WHERE id = ?').bind(JSON.stringify(advice), shot.id).run();
  return c.json({ advice, ai_note });
});

/** "Use for next shot": turns the stored advice into the coffee's active recipe. */
shots.post('/:id/apply-advice', async (c) => {
  const db = c.env.DB;
  const shot = await getShot(db, idParam(c));
  if (!shot) notFound('Shot');
  if (!shot.advice || shot.coffee_id == null) throw new HTTPException(400, { message: 'This shot has no advice to apply.' });
  const recipes = await listRecipes(db, shot.coffee_id);
  const current = currentRecipe(recipes);
  const next = shot.advice.next;

  // Same parameters as the current recipe ("keep") → just make sure it's active (and promising if so).
  if (current && changedVariables(recipeParams(current), next).length === 0 && current.time_min_s === next.time_min_s && current.time_max_s === next.time_max_s) {
    if (shot.advice.promising) await db.prepare('UPDATE recipes SET promising = 1 WHERE id = ?').bind(current.id).run();
    await activateRecipe(db, current);
    return c.json(await getRecipe(db, current.id));
  }
  const recipe = await insertRecipe(db, shot.coffee_id, {
    ...next,
    rationale: `${shot.advice.headline}. ${shot.advice.explanation}`,
    source: 'dial-in',
    status: 'active',
    promising: shot.advice.promising,
    based_on_shot_id: shot.id,
  });
  return c.json(recipe, 201);
});
