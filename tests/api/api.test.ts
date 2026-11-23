import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { get, patch, post, put } from './helpers';

const newCoffee = async (over: Record<string, unknown> = {}) => {
  const { status, data } = await post('/coffees', { name: 'Test Brazil', roast_level: 'medium', status: 'active', ...over });
  expect(status).toBe(201);
  return data;
};

describe('seed data (spec §13)', () => {
  it('imports the seven coffees as historical, none active (rule R7)', async () => {
    const { data } = await get('/coffees');
    expect(data).toHaveLength(7);
    expect(data.every((s: any) => s.coffee.status === 'historical')).toBe(true);
    const dash = await get('/dashboard');
    expect(dash.data.active).toHaveLength(0);
    expect(dash.data.historical_count).toBe(7);
  });

  it('keeps provenance and unknowns: Karamo processing from packaging, roast level estimated', async () => {
    const { data } = await get('/coffees/1');
    expect(data.coffee.field_sources).toMatchObject({ processing: 'packaging', roast_level: 'visual' });
    expect(data.coffee.region).toBeNull();
    const pkg = data.recipes.find((r: any) => r.source === 'packaging');
    expect(pkg).toMatchObject({ dose_g: 20, yield_g: 40, ratio: 2, stated_ratio: 2.25, status: 'superseded' });
    expect(pkg.rationale).toMatch(/1:2, not the printed 1:2.25.*45 g/);
    expect(data.current_recipe).toMatchObject({ yield_g: 45, ratio: 2.25, temperature_c: 94, source: 'historical' });
  });

  it('3 Beans has no invented origin', async () => {
    const { data } = await get('/coffees/5');
    expect(data.coffee).toMatchObject({ origin_country: null, brand: null, processing: null, variety: null, roast_level: 'medium-dark' });
  });

  it('stores the historical shot unattributed', async () => {
    const { data } = await get('/shots?unassigned=1');
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ coffee_id: null, dose_g: 19.7, yield_g: 39.5, time_s: 24, temperature_c: 90 });
    expect(data[0].ratio).toBeCloseTo(2.005, 3);
  });

  it('seeds equipment and preferences', async () => {
    const eq = await get('/equipment');
    expect(eq.data.map((e: any) => e.model)).toContain('Dual Boiler BES920BSS');
    expect(eq.data.map((e: any) => e.model)).toContain('Smart Grinder Pro');
    const s = await get('/settings');
    expect(s.data.brew_preferences).toMatchObject({ dose_g: 20, ratio: 2, time_min_s: 28, time_max_s: 32 });
  });
});

describe('coffees', () => {
  it('creates with provenance: typed fields are "user", AI-reviewed fields keep "packaging"', async () => {
    const c = await newCoffee({ origin_country: 'Brazil', region: 'Minas Gerais', field_sources: { region: 'packaging' } });
    expect(c.field_sources).toEqual({ name: 'user', roast_level: 'user', origin_country: 'user', region: 'packaging' });
  });

  it('editing a field makes it "user"; clearing it makes it unknown', async () => {
    const c = await newCoffee({ processing: 'Natural', field_sources: { processing: 'packaging', roast_level: 'visual' } });
    const r1 = await patch(`/coffees/${c.id}`, { roast_level: 'medium-dark' });
    expect(r1.data.field_sources.roast_level).toBe('user');
    const r2 = await patch(`/coffees/${c.id}`, { processing: null });
    expect(r2.data.processing).toBeNull();
    expect(r2.data.field_sources.processing).toBeUndefined();
  });

  it('can confirm an estimate without changing the value', async () => {
    const c = await newCoffee({ field_sources: { roast_level: 'visual' } });
    const r = await patch(`/coffees/${c.id}`, { field_sources: { roast_level: 'user' } });
    expect(r.data.field_sources.roast_level).toBe('user');
  });

  it('rejects invalid input with details', async () => {
    const r = await post('/coffees', { name: '', roast_level: 'blonde' });
    expect(r.status).toBe(400);
    expect(r.data.details.map((d: any) => d.path)).toEqual(expect.arrayContaining(['name', 'roast_level']));
  });

  it('can be finished/archived without losing history', async () => {
    const c = await newCoffee();
    await post(`/coffees/${c.id}/recipes/suggest`, {});
    await post('/shots', { coffee_id: c.id, dose_g: 20, yield_g: 40, time_s: 30, score: 4 });
    await patch(`/coffees/${c.id}`, { status: 'archived' });
    const d = await get(`/coffees/${c.id}`);
    expect(d.data.coffee.status).toBe('archived');
    expect(d.data.shots).toHaveLength(1);
    expect(d.data.recipes).toHaveLength(1);
  });
});

describe('recipes', () => {
  it('suggests a BDB recipe from the roast level, and does not duplicate on a second tap', async () => {
    const c = await newCoffee({ roast_level: 'light' });
    const r1 = await post(`/coffees/${c.id}/recipes/suggest`, {});
    expect(r1.status).toBe(201);
    expect(r1.data).toMatchObject({ version: 1, dose_g: 20, yield_g: 44, ratio: 2.2, temperature_c: 94, status: 'suggested', source: 'engine' });
    const r2 = await post(`/coffees/${c.id}/recipes/suggest`, {});
    expect(r2.data.id).toBe(r1.data.id);
  });

  it('flags an inconsistent packaging recipe (rule R2)', async () => {
    const c = await newCoffee();
    const r = await post(`/coffees/${c.id}/recipes`, {
      source: 'packaging', stated_ratio: 2.25,
      params: { dose_g: 20, yield_g: 40, temperature_c: null, time_min_s: 28, time_max_s: 28, preinfusion_min_s: null, preinfusion_max_s: null, grind_setting: null, grind_inner: null },
    });
    expect(r.status).toBe(201);
    expect(r.data.ratio).toBe(2);
    expect(r.data.ratio_check).toMatchObject({ consistent: false, yieldForStated: 45 });
  });

  it('activating a recipe supersedes the previous active one', async () => {
    const c = await newCoffee();
    const params = { dose_g: 20, yield_g: 40, temperature_c: 93, time_min_s: 28, time_max_s: 32, preinfusion_min_s: 5, preinfusion_max_s: 8, grind_setting: 14, grind_inner: null };
    const a = await post(`/coffees/${c.id}/recipes`, { params, activate: true });
    const b = await post(`/coffees/${c.id}/recipes`, { params: { ...params, yield_g: 42 } });
    expect(b.data.status).toBe('suggested');
    await post(`/recipes/${b.data.id}/activate`);
    const d = await get(`/coffees/${c.id}`);
    expect(d.data.recipes.map((r: any) => [r.version, r.status])).toEqual([[1, 'superseded'], [2, 'active']]);
    expect(d.data.current_recipe.id).toBe(b.data.id);
    expect(a.data.status).toBe('active');
  });

  it('refuses to activate a printed recipe with no temperature', async () => {
    const r = await post('/recipes/1/activate');
    expect(r.status).toBe(422);
  });
});

describe('shots and the dial-in loop', () => {
  it('handover loop: sour at 24 s → finer; then sweet at 29 s → keep, promising', async () => {
    const c = await newCoffee({ name: 'Lazzio Brazil', roast_level: 'medium' });
    const recipe = (await post(`/coffees/${c.id}/recipes/suggest`, {})).data;

    const first = await post('/shots', { coffee_id: c.id, dose_g: 20, yield_g: 40, time_s: 24, temperature_c: 93, grind_setting: 14, taste_tags: ['sour'] });
    expect(first.status).toBe(201);
    expect(first.data.shot).toMatchObject({ recipe_id: recipe.id, ratio: 2, grinder_model: 'Smart Grinder Pro' });
    expect(first.data.advice).toMatchObject({ adjustment: 'grind_finer', headline: 'Grind finer: 14 → 13' });
    expect(first.data.advice.next).toMatchObject({ dose_g: 20, yield_g: 40, temperature_c: 93, grind_setting: 13 });

    // Logging against a suggested recipe makes it active.
    expect((await get(`/coffees/${c.id}`)).data.current_recipe).toMatchObject({ id: recipe.id, status: 'active' });

    // "Use for next shot" creates version 2 (dial-in) and supersedes version 1.
    const applied = await post(`/shots/${first.data.shot.id}/apply-advice`);
    expect(applied.status).toBe(201);
    expect(applied.data).toMatchObject({ version: 2, source: 'dial-in', status: 'active', grind_setting: 13, based_on_shot_id: first.data.shot.id });

    const second = await post('/shots', { coffee_id: c.id, dose_g: 20, yield_g: 40, time_s: 29, grind_setting: 13, taste_tags: ['sweet', 'chocolate'], score: 5 });
    expect(second.data.shot.recipe_id).toBe(applied.data.id);
    expect(second.data.shot.temperature_c).toBe(93); // prefilled from the recipe
    expect(second.data.advice).toMatchObject({ adjustment: 'keep', promising: true });

    const d = await get(`/coffees/${c.id}`);
    expect(d.data.best_shot.id).toBe(second.data.shot.id);
    expect(d.data.current_recipe).toMatchObject({ id: applied.data.id, promising: true });
    expect(d.data.shot_count).toBe(2);
    expect(d.data.avg_score).toBe(5);

    // Applying a "keep" doesn't create a duplicate version.
    const keep = await post(`/shots/${second.data.shot.id}/apply-advice`);
    expect(keep.data.id).toBe(applied.data.id);
  });

  it('a recipe change never alters recorded shots (rule R3)', async () => {
    const c = await newCoffee();
    const recipe = (await post(`/coffees/${c.id}/recipes/suggest`, {})).data;
    const s = (await post('/shots', { coffee_id: c.id, dose_g: 20, yield_g: 40, time_s: 22, grind_setting: 15, taste_tags: ['sour'] })).data.shot;
    await post(`/shots/${s.id}/apply-advice`);
    await post(`/coffees/${c.id}/recipes`, { params: { ...recipe, yield_g: 50, temperature_c: 95 }, activate: true });
    const after = (await get(`/shots/${s.id}`)).data;
    const { advice: _a, ...before } = s;
    const { advice: _b, ...now } = after;
    expect(now).toEqual(before);
  });

  it('mark_active moves a historical coffee into stock when you log a shot', async () => {
    const r = await post('/shots', { coffee_id: 6, dose_g: 20, yield_g: 40, time_s: 28, mark_active: true });
    expect(r.status).toBe(201);
    expect((await get('/coffees/6')).data.coffee.status).toBe('active');
    expect((await get('/dashboard')).data.active.map((s: any) => s.coffee.id)).toContain(6);
  });

  it('logging without mark_active keeps the status', async () => {
    await post('/shots', { coffee_id: 3, dose_g: 20, yield_g: 40, time_s: 28 });
    expect((await get('/coffees/3')).data.coffee.status).toBe('historical');
  });

  it('editing a shot recomputes its advice; assigning the historical shot works', async () => {
    const c = await newCoffee();
    const s = (await post('/shots', { coffee_id: c.id, dose_g: 20, yield_g: 40, time_s: 30 })).data.shot;
    expect(s.advice.adjustment).toBe('keep');
    const edited = await patch(`/shots/${s.id}`, { taste_tags: ['bitter'] });
    expect(edited.data.advice.adjustment).toBe('decrease_temp');

    const hist = (await get('/shots?unassigned=1')).data[0];
    const assigned = await patch(`/shots/${hist.id}`, { coffee_id: c.id });
    expect(assigned.data.coffee_id).toBe(c.id);
    expect((await get('/shots?unassigned=1')).data).toHaveLength(0);
  });

  it('validates shots', async () => {
    const r = await post('/shots', { coffee_id: 1, dose_g: -1, yield_g: 40, time_s: 30, score: 9, taste_tags: ['salty'] });
    expect(r.status).toBe(400);
    expect(r.data.details.map((d: any) => d.path)).toEqual(expect.arrayContaining(['dose_g', 'score']));
  });
});

describe('photos (R2)', () => {
  it('uploads, attaches to a new coffee and streams back', async () => {
    const { exports } = await import('cloudflare:workers');
    const form = new FormData();
    form.append('file', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'bag.jpg', { type: 'image/jpeg' }));
    form.append('image_type', 'packaging');
    const up = await (exports as any).default.fetch(new Request('https://shotlog.test/api/images', { method: 'POST', body: form }));
    expect(up.status).toBe(201);
    const img = await up.json();
    expect(img).toMatchObject({ coffee_id: null, image_type: 'packaging', url: `/api/images/${img.id}/file` });

    const c = await newCoffee({ image_ids: [img.id] });
    const d = await get(`/coffees/${c.id}`);
    expect(d.data.images.map((i: any) => i.id)).toEqual([img.id]);

    const file = await (exports as any).default.fetch(new Request(`https://shotlog.test${img.url}`));
    expect(file.headers.get('Content-Type')).toBe('image/jpeg');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  });

  it('rejects non-images', async () => {
    const { exports } = await import('cloudflare:workers');
    const form = new FormData();
    form.append('file', new File(['hello'], 'x.txt', { type: 'text/plain' }));
    const r = await (exports as any).default.fetch(new Request('https://shotlog.test/api/images', { method: 'POST', body: form }));
    expect(r.status).toBe(415);
  });
});

describe('settings, status, export, auth', () => {
  it('updates brew preferences used by new suggestions', async () => {
    await put('/settings', { dose_g: 18, ratio: 2, time_min_s: 27, time_max_s: 31, preinfusion_min_s: 5, preinfusion_max_s: 7 });
    const c = await newCoffee({ roast_level: 'medium' });
    const r = await post(`/coffees/${c.id}/recipes/suggest`, {});
    expect(r.data).toMatchObject({ dose_g: 18, yield_g: 36, preinfusion_max_s: 7 });
  });

  it('reports AI as not configured and AI endpoints as unavailable (app still works)', async () => {
    const s = await get('/status');
    expect(s.data).toMatchObject({ ai_configured: false, ai_calls_today: 0, ai_daily_limit: 30 });
    expect((await post('/ai/extract-packaging', { image_ids: [1] })).status).toBe(503);
  });

  it('exports every table', async () => {
    const r = await get('/export');
    expect(r.status).toBe(200);
    expect(Object.keys(r.data)).toEqual(expect.arrayContaining(['coffees', 'recipes', 'shots', 'coffee_images', 'equipment', 'settings', 'ai_usage']));
    expect(r.data.coffees.length).toBeGreaterThanOrEqual(7);
    expect(r.data.coffees.filter((c: any) => c.status === 'historical').length).toBeGreaterThanOrEqual(5);
  });

  it('fails closed when Access is not configured', async () => {
    const { app } = await import('../../src/worker/app');
    const res = await app.request('/api/dashboard', {}, { ...env, AUTH_DISABLED: 'false', ACCESS_AUD: '', ACCESS_TEAM_DOMAIN: '' });
    expect(res.status).toBe(503);
  });

  it('rejects requests without an Access token when Access is configured', async () => {
    const { app } = await import('../../src/worker/app');
    const res = await app.request('/api/dashboard', {}, { ...env, AUTH_DISABLED: 'false', ACCESS_AUD: 'aud123', ACCESS_TEAM_DOMAIN: 'myteam.cloudflareaccess.com' });
    expect(res.status).toBe(401);
  });

  it('data survives a fresh app instance (close and reopen)', async () => {
    const c = await newCoffee({ name: 'Persisted' });
    const { app } = await import('../../src/worker/app');
    const res = await app.request(`/api/coffees/${c.id}`, {}, env);
    expect((await res.json() as any).coffee.name).toBe('Persisted');
  });
});

describe('M5: compare, stats, CSV, inventory', () => {
  it('compares coffees and finds the most chocolate-forward one', async () => {
    const a = (await post('/coffees', { name: 'Choc Brazil', roast_level: 'medium' })).data;
    const b = (await post('/coffees', { name: 'Fruity Kenya', roast_level: 'light' })).data;
    await post('/shots', { coffee_id: a.id, dose_g: 20, yield_g: 40, time_s: 29, taste_tags: ['sweet', 'chocolate'], score: 4 });
    await post('/shots', { coffee_id: a.id, dose_g: 20, yield_g: 40, time_s: 30, taste_tags: ['chocolate', 'caramel'], score: 5 });
    await post('/shots', { coffee_id: b.id, dose_g: 20, yield_g: 44, time_s: 30, taste_tags: ['fruity', 'sweet'], score: 4 });
    const r = await get(`/compare?ids=${a.id},${b.id}`);
    expect(r.status).toBe(200);
    expect(r.data.items.map((i: any) => i.coffee.name)).toEqual(['Choc Brazil', 'Fruity Kenya']);
    expect(r.data.items[0].stats).toMatchObject({ shots: 2, avg_score: 4.5, flavour_share: { chocolate: 1 } });
    expect(r.data.highlights.chocolate).toMatchObject({ coffee_id: a.id, value: 1 });
    expect(r.data.highlights.fruity).toMatchObject({ coffee_id: b.id });
    expect(r.data.highlights.best_avg_score.coffee_id).toBe(a.id);
    expect((await get('/compare')).status).toBe(400);
  });

  it('coffee detail includes planned vs actual per recipe', async () => {
    const c = (await post('/coffees', { name: 'Stats', roast_level: 'medium' })).data;
    await post(`/coffees/${c.id}/recipes/suggest`, {});
    await post('/shots', { coffee_id: c.id, dose_g: 20, yield_g: 40, time_s: 24, taste_tags: ['sour'], score: 2 });
    await post('/shots', { coffee_id: c.id, dose_g: 20, yield_g: 41, time_s: 30, taste_tags: ['sweet'], score: 4 });
    const d = (await get(`/coffees/${c.id}`)).data;
    expect(d.stats.recipes[0]).toMatchObject({ version: 1, shots: 2, avg_score: 3, avg_time: 27, on_target: 0.5 });
    expect(d.stats.most_successful_recipe.version).toBe(1);
  });

  it('deducts the dose from grams left when tracked', async () => {
    const c = (await post('/coffees', { name: 'Inventory', remaining_g: 250 })).data;
    await post('/shots', { coffee_id: c.id, dose_g: 20.5, yield_g: 40, time_s: 30 });
    expect((await get(`/coffees/${c.id}`)).data.coffee.remaining_g).toBe(229.5);
    const untracked = (await post('/coffees', { name: 'Untracked' })).data;
    await post('/shots', { coffee_id: untracked.id, dose_g: 20, yield_g: 40, time_s: 30 });
    expect((await get(`/coffees/${untracked.id}`)).data.coffee.remaining_g).toBeNull();
  });

  it('exports shots and coffees as CSV', async () => {
    const { exports } = await import('cloudflare:workers');
    const res = await (exports as any).default.fetch(new Request('https://shotlog.test/api/export/shots.csv'));
    expect(res.headers.get('Content-Type')).toMatch(/text\/csv/);
    const text = await res.text();
    const [header, ...rows] = text.trim().split('\r\n');
    expect(header.split(',').slice(0, 7)).toEqual(['shot_id', 'pulled_at', 'coffee', 'recipe_version', 'dose_g', 'yield_g', 'ratio']);
    expect(rows.some((r: string) => r.includes('19.7,39.5,1:2.01'))).toBe(true);
    const coffees = await (await (exports as any).default.fetch(new Request('https://shotlog.test/api/export/coffees.csv'))).text();
    expect(coffees).toContain('Lazzio Brazil Single Origin');
    expect(coffees).toMatch(/Minas Gerais,packaging/);
  });
});
