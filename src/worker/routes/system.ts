import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { body, idParam, notFound } from '../http';
import { equipmentUpdateSchema, preferencesSchema } from '../schemas';
import { getPreferences, summarizeMany, toCoffee, toEquipment, toRecipe, toShot } from '../db';
import { coffeeStats, compareHighlights } from '../../shared/stats';
import { toCsv } from '../../shared/csv';
import { formatRatio, roastAgeDays } from '../../shared/ratio';
import { HTTPException } from 'hono/http-exception';
import { aiConfigured } from '../ai/service';
import type { AppStatus, Dashboard } from '../../shared/types';

export const system = new Hono<AppEnv>();

export const APP_VERSION = '0.1.0';

system.get('/dashboard', async (c) => {
  const db = c.env.DB;
  const [active, recent, last, counts] = await Promise.all([
    db.prepare("SELECT * FROM coffees WHERE status = 'active' ORDER BY updated_at DESC").all(),
    db.prepare(
      `SELECT c.* FROM coffees c JOIN (SELECT coffee_id, MAX(pulled_at) AS last FROM shots WHERE coffee_id IS NOT NULL GROUP BY coffee_id) s
       ON s.coffee_id = c.id WHERE c.status != 'active' ORDER BY s.last DESC LIMIT 5`,
    ).all(),
    db.prepare('SELECT s.*, c.name AS coffee_name FROM shots s LEFT JOIN coffees c ON c.id = s.coffee_id ORDER BY s.pulled_at DESC, s.id DESC LIMIT 1').first(),
    db.prepare(
      "SELECT (SELECT COUNT(*) FROM coffees WHERE status = 'historical') AS historical, (SELECT COUNT(*) FROM shots WHERE coffee_id IS NULL) AS unassigned",
    ).first<{ historical: number; unassigned: number }>(),
  ]);
  const dashboard: Dashboard = {
    active: await summarizeMany(db, active.results.map(toCoffee)),
    recent: await summarizeMany(db, recent.results.map(toCoffee)),
    last_shot: last ? { ...toShot(last), coffee_name: (last.coffee_name as string | null) ?? null } : null,
    historical_count: counts?.historical ?? 0,
    unassigned_shot_count: counts?.unassigned ?? 0,
  };
  return c.json(dashboard);
});

system.get('/settings', async (c) => c.json({ brew_preferences: await getPreferences(c.env.DB) }));

system.put('/settings', async (c) => {
  const prefs = await body(c, preferencesSchema);
  await c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('brew_preferences', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify(prefs)).run();
  return c.json({ brew_preferences: prefs });
});

system.get('/equipment', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM equipment ORDER BY id').all();
  return c.json(results.map(toEquipment));
});

system.put('/equipment/:id', async (c) => {
  const id = idParam(c);
  const changes = await body(c, equipmentUpdateSchema);
  const cols = Object.keys(changes) as Array<keyof typeof changes>;
  const row = await c.env.DB.prepare(`UPDATE equipment SET ${cols.map((k) => `${k} = ?`).join(', ') || 'id = id'} WHERE id = ? RETURNING *`)
    .bind(...cols.map((k) => (k === 'configuration' ? JSON.stringify(changes[k]) : changes[k] ?? null)), id).first();
  if (!row) notFound('Equipment');
  return c.json(toEquipment(row));
});

system.get('/status', async (c) => {
  const usage = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM ai_usage WHERE outcome != 'blocked_by_cap' AND called_at >= strftime('%Y-%m-%dT00:00:00', 'now')) AS today,
       (SELECT COUNT(*) FROM ai_usage WHERE outcome != 'blocked_by_cap' AND called_at >= strftime('%Y-%m-01T00:00:00', 'now')) AS month_calls,
       (SELECT COALESCE(SUM(est_cost_usd), 0) FROM ai_usage WHERE called_at >= strftime('%Y-%m-01T00:00:00', 'now')) AS month_cost`,
  ).first<{ today: number; month_calls: number; month_cost: number }>();
  const status: AppStatus = {
    version: APP_VERSION,
    ai_configured: aiConfigured(c.env),
    ai_calls_today: usage?.today ?? 0,
    ai_daily_limit: Number(c.env.AI_DAILY_CALL_LIMIT) || 30,
    ai_cost_month_usd: Math.round((usage?.month_cost ?? 0) * 10000) / 10000,
    ai_calls_month: usage?.month_calls ?? 0,
  };
  return c.json(status);
});

/** Full JSON export of every table (photos are referenced by key; download them via /api/images/:id/file). */
system.get('/export', async (c) => {
  const db = c.env.DB;
  const tables = ['coffees', 'recipes', 'shots', 'coffee_images', 'equipment', 'settings', 'ai_usage'] as const;
  const out: Record<string, unknown> = { exported_at: new Date().toISOString(), app_version: APP_VERSION };
  const results = await db.batch(tables.map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY 1`)));
  tables.forEach((t, i) => { out[t] = results[i].results; });
  return c.json(out, 200, { 'Content-Disposition': `attachment; filename="shotlog-export-${new Date().toISOString().slice(0, 10)}.json"` });
});

/** Side-by-side comparison of 2+ coffees (spec §4.F). */
system.get('/compare', async (c) => {
  const ids = Array.from(new Set((c.req.query('ids') ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0))).slice(0, 6);
  if (!ids.length) throw new HTTPException(400, { message: 'Pick at least one coffee (ids=1,2)' });
  const db = c.env.DB;
  const ph = ids.map(() => '?').join(',');
  const [coffees, recipes, shots] = await Promise.all([
    db.prepare(`SELECT * FROM coffees WHERE id IN (${ph})`).bind(...ids).all(),
    db.prepare(`SELECT * FROM recipes WHERE coffee_id IN (${ph}) ORDER BY version`).bind(...ids).all(),
    db.prepare(`SELECT * FROM shots WHERE coffee_id IN (${ph}) ORDER BY pulled_at DESC, id DESC`).bind(...ids).all(),
  ]);
  const allRecipes = recipes.results.map(toRecipe);
  const allShots = shots.results.map(toShot);
  const summaries = await summarizeMany(db, coffees.results.map(toCoffee));
  const items = ids.map((id) => summaries.find((s) => s.coffee.id === id)).filter((s) => s != null).map((summary) => ({
    ...summary,
    stats: coffeeStats(summary.coffee, allShots.filter((s) => s.coffee_id === summary.coffee.id), allRecipes.filter((r) => r.coffee_id === summary.coffee.id)),
  }));
  return c.json({ items, highlights: compareHighlights(items.map((i) => ({ coffee_id: i.coffee.id, stats: i.stats }))) });
});

/** CSV exports for spreadsheets: every shot (with its coffee), or every coffee. */
system.get('/export/shots.csv', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.*, c.name AS coffee_name, c.roast_date AS roast_date, r.version AS recipe_version
     FROM shots s LEFT JOIN coffees c ON c.id = s.coffee_id LEFT JOIN recipes r ON r.id = s.recipe_id
     ORDER BY s.pulled_at, s.id`,
  ).all();
  const csv = toCsv(
    ['shot_id', 'pulled_at', 'coffee', 'recipe_version', 'dose_g', 'yield_g', 'ratio', 'time_s', 'temperature_c', 'preinfusion_s', 'grind', 'inner_burr', 'roast_age_days', 'taste', 'score', 'feedback', 'notes', 'next_advice'],
    results.map((row) => {
      const s = toShot(row);
      return [s.id, s.pulled_at, row.coffee_name, row.recipe_version, s.dose_g, s.yield_g, formatRatio(s.dose_g, s.yield_g), s.time_s, s.temperature_c,
        s.preinfusion_s, s.grind_setting, s.grind_inner, roastAgeDays(row.roast_date as string | null, s.pulled_at), s.taste_tags, s.score, s.feedback, s.notes,
        s.advice?.headline ?? null];
    }),
  );
  return c.body(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="shotlog-shots-${new Date().toISOString().slice(0, 10)}.csv"` });
});

system.get('/export/coffees.csv', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM coffees ORDER BY id').all();
  const fields = ['name', 'brand', 'product', 'origin_country', 'region', 'farm', 'variety', 'processing', 'roast_level', 'roast_date', 'altitude', 'intensity', 'cupping_score', 'tasting_notes'] as const;
  const csv = toCsv(
    ['coffee_id', 'status', ...fields.flatMap((f) => [f, `${f}_source`]), 'purchase_date', 'remaining_g', 'notes'],
    results.map((row) => {
      const cf = toCoffee(row);
      return [cf.id, cf.status, ...fields.flatMap((f) => [cf[f], cf[f] == null || (Array.isArray(cf[f]) && !(cf[f] as unknown[]).length) ? null : cf.field_sources[f] ?? null]), cf.purchase_date, cf.remaining_g, cf.notes];
    }),
  );
  return c.body(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="shotlog-coffees-${new Date().toISOString().slice(0, 10)}.csv"` });
});
