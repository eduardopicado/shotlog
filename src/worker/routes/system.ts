import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { body, idParam, notFound } from '../http';
import { equipmentUpdateSchema, preferencesSchema } from '../schemas';
import { getPreferences, summarizeMany, toCoffee, toEquipment, toShot } from '../db';
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
