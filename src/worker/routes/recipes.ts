import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../app';
import { body, idParam, notFound } from '../http';
import { createRecipeSchema, suggestRecipeSchema } from '../schemas';
import { activateRecipe, getCoffee, getPreferences, getRecipe, insertRecipe, listRecipes, listShots, recipeParams, toShot } from '../db';
import { changedVariables, suggestInitialRecipe } from '../../shared/engine';
import { checkStatedRatio } from '../../shared/ratio';
import { refineRecipeWithAi } from '../ai/service';

export const recipes = new Hono<AppEnv>();

/** New suggested recipe from the engine (optionally refined by AI). */
recipes.post('/coffees/:id/recipes/suggest', async (c) => {
  const coffeeId = idParam(c);
  const coffee = await getCoffee(c.env.DB, coffeeId);
  if (!coffee) notFound('Coffee');
  const { use_ai } = await body(c, suggestRecipeSchema);
  const [prefs, shots, existing, lastAny] = await Promise.all([
    getPreferences(c.env.DB),
    listShots(c.env.DB, coffeeId),
    listRecipes(c.env.DB, coffeeId),
    c.env.DB.prepare(
      `SELECT s.*, c.name AS coffee_name FROM shots s LEFT JOIN coffees c ON c.id = s.coffee_id
       WHERE s.grind_setting IS NOT NULL ORDER BY s.pulled_at DESC LIMIT 1`,
    ).first(),
  ]);
  const suggestion = suggestInitialRecipe(coffee, {
    prefs,
    shotsThisCoffee: shots,
    lastShotAnyCoffee: lastAny ? { grind_setting: toShot(lastAny).grind_setting, coffee_name: (lastAny.coffee_name as string | null) ?? null } : null,
  });

  let params = suggestion.params;
  let rationale = suggestion.rationale;
  let source: 'engine' | 'ai' = 'engine';
  if (use_ai) {
    const refined = await refineRecipeWithAi(c.env, { coffee, engine: suggestion, shots, prefs });
    params = refined.params;
    rationale = refined.rationale;
    source = 'ai';
  }

  // Don't pile up identical suggestions when the button is tapped twice.
  const latest = existing.at(-1);
  if (latest && latest.status === 'suggested' && latest.source === source && changedVariables(recipeParams(latest), params).length === 0
      && latest.time_min_s === params.time_min_s && latest.time_max_s === params.time_max_s) {
    return c.json(latest);
  }
  const recipe = await insertRecipe(c.env.DB, coffeeId, { ...params, rationale, source, status: 'suggested' });
  return c.json(recipe, 201);
});

/** Manual or packaging recipe. Packaging recipes keep the printed ratio and are checked (rule R2). */
recipes.post('/coffees/:id/recipes', async (c) => {
  const coffeeId = idParam(c);
  if (!(await getCoffee(c.env.DB, coffeeId))) notFound('Coffee');
  const input = await body(c, createRecipeSchema);
  const check = checkStatedRatio(input.params.dose_g, input.params.yield_g, input.stated_ratio);
  const rationale = [input.rationale, check.message].filter(Boolean).join(' ') || null;
  const recipe = await insertRecipe(c.env.DB, coffeeId, {
    ...input.params,
    rationale,
    source: input.source,
    status: input.activate ? 'active' : 'suggested',
    stated_ratio: input.stated_ratio,
  });
  return c.json({ ...recipe, ratio_check: check }, 201);
});

recipes.post('/recipes/:id/activate', async (c) => {
  const recipe = await getRecipe(c.env.DB, idParam(c));
  if (!recipe) notFound('Recipe');
  if (recipe.temperature_c == null) {
    throw new HTTPException(422, { message: 'This printed recipe has no temperature; create a new version with one before using it.' });
  }
  await activateRecipe(c.env.DB, recipe);
  return c.json(await getRecipe(c.env.DB, recipe.id));
});
