import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { body, idParam, notFound } from '../http';
import { createCoffeeSchema, updateCoffeeSchema } from '../schemas';
import { getCoffee, listRecipes, listShots, nowIso, summarize, summarizeMany, toCoffee, toImage } from '../db';
import type { CoffeeDetail, FieldSources } from '../../shared/types';
import { COFFEE_STATUSES, SOURCED_FIELDS } from '../../shared/types';
import { coffeeStats } from '../../shared/stats';

export const coffees = new Hono<AppEnv>();

const COLUMNS = [
  'name', 'brand', 'product', 'origin_country', 'region', 'farm', 'variety', 'processing', 'roast_level', 'roast_date',
  'purchase_date', 'tasting_notes', 'cupping_score', 'intensity', 'altitude', 'status', 'remaining_g', 'notes',
] as const;

const isEmpty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
const dbValue = (key: string, v: unknown) => (key === 'tasting_notes' ? JSON.stringify(v ?? []) : v ?? null);

/**
 * Provenance (spec §6): a field you set or edit becomes 'user' unless the request
 * says where it came from (e.g. 'packaging' from the AI review screen). An emptied
 * field has no source — it's Unknown.
 */
function mergeSources(
  current: FieldSources,
  currentValues: Record<string, unknown>,
  changes: Record<string, unknown>,
  explicit: FieldSources = {},
): FieldSources {
  const next: FieldSources = { ...current };
  for (const f of SOURCED_FIELDS) {
    if (f in changes) {
      if (isEmpty(changes[f])) delete next[f];
      else next[f] = explicit[f] ?? 'user';
    } else if (explicit[f] && !isEmpty(currentValues[f])) {
      next[f] = explicit[f]; // e.g. confirming an estimate without changing the value
    }
  }
  return next;
}

coffees.get('/', async (c) => {
  const statuses = (c.req.query('status') ?? '').split(',').filter((s) => (COFFEE_STATUSES as readonly string[]).includes(s));
  const where = statuses.length ? `WHERE status IN (${statuses.map(() => '?').join(',')})` : '';
  const { results } = await c.env.DB.prepare(`SELECT * FROM coffees ${where} ORDER BY updated_at DESC`).bind(...statuses).all();
  return c.json(await summarizeMany(c.env.DB, results.map(toCoffee)));
});

coffees.post('/', async (c) => {
  const input = await body(c, createCoffeeSchema);
  const { image_ids, field_sources, ...fields } = input;
  const sources = mergeSources({}, {}, fields as Record<string, unknown>, field_sources);
  const cols = COLUMNS.filter((k) => k in fields);
  const row = await c.env.DB.prepare(
    `INSERT INTO coffees (${[...cols, 'field_sources'].join(', ')}) VALUES (${[...cols, 'field_sources'].map(() => '?').join(', ')}) RETURNING *`,
  ).bind(...cols.map((k) => dbValue(k, (fields as Record<string, unknown>)[k])), JSON.stringify(sources)).first();
  const coffee = toCoffee(row!);
  if (image_ids.length) {
    await c.env.DB.prepare(`UPDATE coffee_images SET coffee_id = ? WHERE coffee_id IS NULL AND id IN (${image_ids.map(() => '?').join(',')})`)
      .bind(coffee.id, ...image_ids).run();
  }
  return c.json(coffee, 201);
});

coffees.get('/:id', async (c) => {
  const id = idParam(c);
  const coffee = await getCoffee(c.env.DB, id);
  if (!coffee) notFound('Coffee');
  const [recipes, shots, imgs] = await Promise.all([
    listRecipes(c.env.DB, id),
    listShots(c.env.DB, id),
    c.env.DB.prepare('SELECT * FROM coffee_images WHERE coffee_id = ? ORDER BY created_at').bind(id).all(),
  ]);
  const detail: CoffeeDetail = {
    ...summarize(coffee, recipes, shots), recipes, shots, images: imgs.results.map(toImage), stats: coffeeStats(coffee, shots, recipes),
  };
  return c.json(detail);
});

coffees.patch('/:id', async (c) => {
  const id = idParam(c);
  const coffee = await getCoffee(c.env.DB, id);
  if (!coffee) notFound('Coffee');
  const { field_sources, ...changes } = await body(c, updateCoffeeSchema);
  const sources = mergeSources(coffee.field_sources, coffee as unknown as Record<string, unknown>, changes as Record<string, unknown>, field_sources);
  const cols = COLUMNS.filter((k) => k in changes);
  const sets = [...cols.map((k) => `${k} = ?`), 'field_sources = ?', 'updated_at = ?'];
  const row = await c.env.DB.prepare(`UPDATE coffees SET ${sets.join(', ')} WHERE id = ? RETURNING *`)
    .bind(...cols.map((k) => dbValue(k, (changes as Record<string, unknown>)[k])), JSON.stringify(sources), nowIso(), id)
    .first();
  return c.json(toCoffee(row!));
});
