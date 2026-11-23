// Data access for D1: row mapping (JSON columns, booleans) and shared queries.

import type {
  Advice, BrewPreferences, Coffee, CoffeeImage, CoffeeSummary, Equipment, EquipmentLimits, Recipe, RecipeParams, Shot,
} from '../shared/types';
import { DEFAULT_LIMITS, DEFAULT_PREFERENCES } from '../shared/types';
import { bestShot } from '../shared/engine';
import { roastAgeDays } from '../shared/ratio';

type Row = Record<string, unknown>;

const json = <T>(v: unknown, fallback: T): T => {
  if (v == null || v === '') return fallback;
  try { return JSON.parse(String(v)) as T; } catch { return fallback; }
};

export const toCoffee = (r: Row): Coffee => ({
  ...(r as unknown as Coffee),
  tasting_notes: json<string[]>(r.tasting_notes, []),
  field_sources: json(r.field_sources, {}),
});

export const toRecipe = (r: Row): Recipe => ({
  ...(r as unknown as Recipe),
  promising: Boolean(r.promising),
});

export const toShot = (r: Row): Shot => ({
  ...(r as unknown as Shot),
  taste_tags: json(r.taste_tags, []),
  advice: json<Advice | null>(r.advice, null),
});

export const toImage = (r: Row): CoffeeImage => ({
  id: r.id as number,
  coffee_id: (r.coffee_id as number | null) ?? null,
  image_type: r.image_type as CoffeeImage['image_type'],
  url: `/api/images/${r.id}/file`,
  ai_observations: json(r.ai_observations, null),
  created_at: r.created_at as string,
});

export const toEquipment = (r: Row): Equipment => ({
  ...(r as unknown as Equipment),
  configuration: json(r.configuration, {}),
});

export function recipeParams(r: RecipeParams): RecipeParams {
  return {
    dose_g: r.dose_g, yield_g: r.yield_g, temperature_c: r.temperature_c,
    time_min_s: r.time_min_s, time_max_s: r.time_max_s,
    preinfusion_min_s: r.preinfusion_min_s, preinfusion_max_s: r.preinfusion_max_s,
    grind_setting: r.grind_setting, grind_inner: r.grind_inner,
  };
}

export const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------

export async function getCoffee(db: D1Database, id: number): Promise<Coffee | null> {
  const r = await db.prepare('SELECT * FROM coffees WHERE id = ?').bind(id).first();
  return r ? toCoffee(r) : null;
}

export async function getRecipe(db: D1Database, id: number): Promise<Recipe | null> {
  const r = await db.prepare('SELECT * FROM recipes WHERE id = ?').bind(id).first();
  return r ? toRecipe(r) : null;
}

export async function getShot(db: D1Database, id: number): Promise<Shot | null> {
  const r = await db.prepare('SELECT * FROM shots WHERE id = ?').bind(id).first();
  return r ? toShot(r) : null;
}

export async function listRecipes(db: D1Database, coffeeId: number): Promise<Recipe[]> {
  const { results } = await db.prepare('SELECT * FROM recipes WHERE coffee_id = ? ORDER BY version').bind(coffeeId).all();
  return results.map(toRecipe);
}

export async function listShots(db: D1Database, coffeeId: number): Promise<Shot[]> {
  const { results } = await db.prepare('SELECT * FROM shots WHERE coffee_id = ? ORDER BY pulled_at DESC, id DESC').bind(coffeeId).all();
  return results.map(toShot);
}

/** Current recipe = the active one, else the newest suggested one (spec §5.5). */
export function currentRecipe(recipes: Recipe[]): Recipe | null {
  return recipes.find((r) => r.status === 'active')
    ?? [...recipes].filter((r) => r.status === 'suggested').sort((a, b) => b.version - a.version)[0]
    ?? null;
}

export function summarize(coffee: Coffee, recipes: Recipe[], shots: Shot[]): CoffeeSummary {
  const scored = shots.filter((s) => s.score != null);
  return {
    coffee,
    current_recipe: currentRecipe(recipes),
    last_shot: shots[0] ?? null,
    best_shot: bestShot(shots),
    shot_count: shots.length,
    avg_score: scored.length ? Math.round((scored.reduce((a, s) => a + s.score!, 0) / scored.length) * 10) / 10 : null,
    roast_age_days: roastAgeDays(coffee.roast_date),
  };
}

/** Summaries for many coffees with three queries total. */
export async function summarizeMany(db: D1Database, coffees: Coffee[]): Promise<CoffeeSummary[]> {
  if (!coffees.length) return [];
  const ids = coffees.map((c) => c.id);
  const ph = ids.map(() => '?').join(',');
  const [recipes, shots] = await Promise.all([
    db.prepare(`SELECT * FROM recipes WHERE coffee_id IN (${ph}) ORDER BY version`).bind(...ids).all(),
    db.prepare(`SELECT * FROM shots WHERE coffee_id IN (${ph}) ORDER BY pulled_at DESC, id DESC`).bind(...ids).all(),
  ]);
  const rByCoffee = new Map<number, Recipe[]>();
  for (const r of recipes.results.map(toRecipe)) rByCoffee.set(r.coffee_id, [...(rByCoffee.get(r.coffee_id) ?? []), r]);
  const sByCoffee = new Map<number, Shot[]>();
  for (const s of shots.results.map(toShot)) sByCoffee.set(s.coffee_id!, [...(sByCoffee.get(s.coffee_id!) ?? []), s]);
  return coffees.map((c) => summarize(c, rByCoffee.get(c.id) ?? [], sByCoffee.get(c.id) ?? []));
}

export async function nextRecipeVersion(db: D1Database, coffeeId: number): Promise<number> {
  const r = await db.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM recipes WHERE coffee_id = ?').bind(coffeeId).first<{ v: number }>();
  return r?.v ?? 1;
}

export interface NewRecipe extends RecipeParams {
  rationale: string | null;
  source: Recipe['source'];
  status: Recipe['status'];
  promising?: boolean;
  stated_ratio?: number | null;
  based_on_shot_id?: number | null;
}

/** Inserts a recipe version; if status is 'active', supersedes the previous active recipe atomically. */
export async function insertRecipe(db: D1Database, coffeeId: number, r: NewRecipe): Promise<Recipe> {
  const version = await nextRecipeVersion(db, coffeeId);
  const insert = db.prepare(
    `INSERT INTO recipes (coffee_id, version, dose_g, yield_g, temperature_c, time_min_s, time_max_s, preinfusion_min_s, preinfusion_max_s,
       grind_setting, grind_inner, rationale, source, status, promising, stated_ratio, based_on_shot_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
  ).bind(
    coffeeId, version, r.dose_g, r.yield_g, r.temperature_c, r.time_min_s, r.time_max_s, r.preinfusion_min_s, r.preinfusion_max_s,
    r.grind_setting, r.grind_inner, r.rationale, r.source, r.status, r.promising ? 1 : 0, r.stated_ratio ?? null, r.based_on_shot_id ?? null,
  );
  if (r.status === 'active') {
    const [, inserted] = await db.batch([
      db.prepare("UPDATE recipes SET status = 'superseded' WHERE coffee_id = ? AND status = 'active'").bind(coffeeId),
      insert,
    ]);
    return toRecipe(inserted.results[0] as Row);
  }
  const row = await insert.first();
  return toRecipe(row as Row);
}

/** Makes a recipe the active one for its coffee; the previous active one becomes superseded. */
export async function activateRecipe(db: D1Database, recipe: Recipe): Promise<void> {
  if (recipe.status === 'active') return;
  await db.batch([
    db.prepare("UPDATE recipes SET status = 'superseded' WHERE coffee_id = ? AND status = 'active'").bind(recipe.coffee_id),
    db.prepare("UPDATE recipes SET status = 'active' WHERE id = ?").bind(recipe.id),
  ]);
}

export async function getPreferences(db: D1Database): Promise<BrewPreferences> {
  const r = await db.prepare("SELECT value FROM settings WHERE key = 'brew_preferences'").first<{ value: string }>();
  return { ...DEFAULT_PREFERENCES, ...json(r?.value, {}) };
}

export async function getLimits(db: D1Database): Promise<EquipmentLimits> {
  const { results } = await db.prepare("SELECT * FROM equipment WHERE equipment_type IN ('machine','grinder')").all();
  const limits = { ...DEFAULT_LIMITS };
  for (const e of results.map(toEquipment)) {
    const c = e.configuration as Record<string, number | boolean>;
    if (e.equipment_type === 'machine') {
      if (typeof c.temp_min === 'number') limits.temp_min = c.temp_min;
      if (typeof c.temp_max === 'number') limits.temp_max = c.temp_max;
    } else {
      if (typeof c.dial_min === 'number') limits.grind_min = c.dial_min;
      if (typeof c.dial_max === 'number') limits.grind_max = c.dial_max;
      if (typeof c.lower_is_finer === 'boolean') limits.lower_is_finer = c.lower_is_finer;
    }
  }
  return limits;
}

export async function grinderModel(db: D1Database): Promise<string | null> {
  const r = await db.prepare("SELECT brand, model FROM equipment WHERE equipment_type = 'grinder' ORDER BY id LIMIT 1").first<{ brand: string; model: string }>();
  return r ? r.model : null;
}
