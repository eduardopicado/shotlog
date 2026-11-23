// AI layer tests with a fake Claude client: no network, no cost.
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../../src/worker/app';
import { setAiClientFactory, type AiClient } from '../../src/worker/ai/client';

type Reply = { parsed_output?: unknown; stop_reason?: string; model?: string; throws?: unknown };
let replies: Reply[] = [];
let calls: any[] = [];

const fake: AiClient = {
  beta: {
    messages: {
      parse: (async (params: any) => {
        calls.push(params);
        const r = replies.shift() ?? { parsed_output: null };
        if (r.throws) throw r.throws;
        return {
          id: 'msg_test', type: 'message', role: 'assistant', content: [],
          model: r.model ?? params.model, stop_reason: r.stop_reason ?? 'end_turn', stop_details: null,
          usage: { input_tokens: 3000, output_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          parsed_output: r.parsed_output ?? null,
        };
      }) as any,
    },
  },
};

const aiEnv = (over: Record<string, string> = {}) => ({ ...env, ANTHROPIC_API_KEY: 'sk-test', AUTH_DISABLED: 'true', ...over });
async function call(method: string, path: string, body?: unknown, envOver: Record<string, string> = {}) {
  const res = await app.request(`/api${path}`, {
    method,
    headers: body instanceof FormData || body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  }, aiEnv(envOver));
  return { status: res.status, data: await res.json() as any };
}

async function upload(type = 'packaging') {
  const form = new FormData();
  form.append('file', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'p.jpg', { type: 'image/jpeg' }));
  form.append('image_type', type);
  return (await call('POST', '/images', form)).data;
}

const fact = (value: string | null, evidence: string | null = value) => ({ value, evidence });
const packagingOutput = {
  name: fact('Ethiopia Karamo'), brand: fact(null), product: fact('Single Origin'), origin_country: fact('Ethiopia'),
  region: fact(null), farm: fact(null), variety: fact('Heirloom'), processing: fact('Natural', 'NATURAL PROCESS'),
  roast_level: { value: null, evidence: null }, roast_date: { value: '26/05', evidence: 'Roasted 26/05' },
  altitude: fact('2000 masl'), intensity: fact('unknown'), cupping_score: { value: null, evidence: null },
  tasting_notes: ['Blueberry', 'jasmine', 'blueberry'],
  packaging_recipe: { dose_g: 20, yield_g: 40, stated_ratio: 2.25, time_s: 28, temperature_c: null },
  raw_text: 'ETHIOPIA KARAMO\nSINGLE ORIGIN\nNATURAL PROCESS\nEspresso 1:2.25 20g in 40g out 28s',
  uncertainties: [],
};

beforeEach(() => {
  replies = [];
  calls = [];
  setAiClientFactory(() => fake);
});

describe('AI: reading the bag', () => {
  it('returns only printed fields with evidence, flags the printed ratio, rejects partial dates', async () => {
    const img = await upload();
    replies.push({ parsed_output: packagingOutput });
    const r = await call('POST', '/ai/extract-packaging', { image_ids: [img.id] });
    expect(r.status).toBe(200);
    expect(r.data.fields).toEqual({ name: 'Ethiopia Karamo', product: 'Single Origin', origin_country: 'Ethiopia', variety: 'Heirloom', processing: 'Natural', altitude: '2000 masl' });
    expect(r.data.fields).not.toHaveProperty('region');
    expect(r.data.fields).not.toHaveProperty('intensity'); // "unknown" is not a value
    expect(r.data.fields).not.toHaveProperty('roast_date');
    expect(r.data.uncertainties.join(' ')).toMatch(/Roasted 26\/05/);
    expect(r.data.evidence.processing).toBe('NATURAL PROCESS');
    expect(r.data.tasting_notes).toEqual(['blueberry', 'jasmine']);
    expect(r.data.ratio_check).toMatchObject({ consistent: false, yieldForStated: 45 });

    // Sent as a base64 image to the vision model, with refusal fallback enabled.
    const req = calls[0];
    expect(req.model).toBe('claude-sonnet-5-5');
    expect(req.fallbacks).toBe('default');
    expect(req.betas).toContain('server-side-fallback-2026-07-01');
    expect(req.messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/2Q==' } });
    expect(req.output_config.format.type).toBe('json_schema');

    // Raw output kept on the photo for traceability.
    const row = await env.DB.prepare('SELECT ai_observations FROM coffee_images WHERE id = ?').bind(img.id).first<{ ai_observations: string }>();
    expect(JSON.parse(row!.ai_observations).kind).toBe('packaging_extraction');
  });

  it('logs usage with an estimated cost', async () => {
    const row = await env.DB.prepare("SELECT * FROM ai_usage WHERE task = 'extract_packaging' AND outcome = 'ok' ORDER BY id DESC").first<any>();
    expect(row).toMatchObject({ model: 'claude-sonnet-5-5', input_tokens: 3000, output_tokens: 1000 });
    expect(row.est_cost_usd).toBeCloseTo(0.016, 5); // 3k × $2/M + 1k × $10/M
  });

  it('a refusal is reported, logged and leaves the manual path open', async () => {
    const img = await upload();
    replies.push({ stop_reason: 'refusal' });
    const r = await call('POST', '/ai/extract-packaging', { image_ids: [img.id] });
    expect(r.status).toBe(422);
    const row = await env.DB.prepare("SELECT outcome FROM ai_usage ORDER BY id DESC").first<any>();
    expect(row.outcome).toBe('refused');
  });

  it('invalid output is rejected', async () => {
    const img = await upload();
    replies.push({ parsed_output: { nonsense: true } });
    expect((await call('POST', '/ai/extract-packaging', { image_ids: [img.id] })).status).toBe(502);
  });
});

describe('AI: bean photos', () => {
  it('saves a visual observation on the photo, separate from coffee facts', async () => {
    const img = await upload('other');
    const obs = {
      roast_estimate: 'medium', roast_estimate_note: 'medium, possibly medium-dark', colour_consistency: 'some variation',
      surface: 'mostly dry', oiliness: 'slight sheen', defects: ['a few broken beans'], general: 'even roast overall', confidence: 'medium',
    };
    replies.push({ parsed_output: obs });
    const r = await call('POST', '/ai/analyze-beans', { image_id: img.id });
    expect(r.status).toBe(200);
    expect(r.data.observation).toEqual(obs);
    expect(r.data.image).toMatchObject({ image_type: 'beans', ai_observations: obs });
  });
});

describe('AI: recipe refinement', () => {
  const coffee = async () => (await call('POST', '/coffees', { name: 'AI Test', roast_level: 'light', processing: 'Natural', field_sources: { processing: 'packaging' } })).data;

  it('accepts an in-bounds recipe, keeps the grind from your own history', async () => {
    const c = await coffee();
    replies.push({ parsed_output: { dose_g: 20, yield_g: 45, temperature_c: 95, time_min_s: 28, time_max_s: 32, preinfusion_min_s: 6, preinfusion_max_s: 8, rationale: 'Light natural: a touch hotter and longer.' } });
    const r = await call('POST', `/coffees/${c.id}/recipes/suggest`, { use_ai: true });
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({ source: 'ai', yield_g: 45, temperature_c: 95, grind_setting: null, rationale: 'Light natural: a touch hotter and longer.' });
    expect(r.data.ai_note).toBeUndefined();
    const ctx = calls[0].messages[0].content[0].text;
    expect(ctx).toContain('"source": "packaging"');
  });

  it('falls back to the engine when the AI goes out of bounds', async () => {
    const c = await coffee();
    replies.push({ parsed_output: { dose_g: 20, yield_g: 70, temperature_c: 99, time_min_s: 28, time_max_s: 32, preinfusion_min_s: 6, preinfusion_max_s: 8, rationale: 'x' } });
    const r = await call('POST', `/coffees/${c.id}/recipes/suggest`, { use_ai: true });
    expect(r.data).toMatchObject({ source: 'engine', yield_g: 44, temperature_c: 94 });
    expect(r.data.ai_note).toMatch(/outside the allowed range/);
  });
});

describe('AI: advice review', () => {
  async function sourShot() {
    const c = (await call('POST', '/coffees', { name: 'Review Test', roast_level: 'medium' })).data;
    await call('POST', `/coffees/${c.id}/recipes/suggest`, {});
    const s = (await call('POST', '/shots', { coffee_id: c.id, dose_g: 20, yield_g: 40, time_s: 30, grind_setting: 14, taste_tags: ['sour'], feedback: 'sharp at the end, otherwise sweet' })).data;
    expect(s.advice.adjustment).toBe('increase_temp');
    return s.shot;
  }
  const next = { dose_g: 20, yield_g: 40, temperature_c: 93, time_min_s: 28, time_max_s: 32, preinfusion_min_s: 5, preinfusion_max_s: 8, grind_setting: 14, grind_inner: null };

  it('accepts a one-variable alternative and records the engine call (Haiku, no fallback param)', async () => {
    const shot = await sourShot();
    replies.push({ parsed_output: { adjustment: 'increase_yield', diagnosis: 'balance', headline: 'Increase yield to 42 g', explanation: 'Sweet with a sharp finish: stretch it a little.', checks: [], promising: false, next: { ...next, yield_g: 42 } } });
    const r = await call('POST', `/shots/${shot.id}/advice`, { use_ai: true });
    expect(r.status).toBe(200);
    expect(r.data.advice).toMatchObject({ source: 'ai', adjustment: 'increase_yield', engine_adjustment: 'increase_temp', next: { yield_g: 42, temperature_c: 93 } });
    expect(calls[0].model).toBe('claude-haiku-5-5');
    expect(calls[0].fallbacks).toBeUndefined();
    expect(calls[0].messages[0].content[0].text).toContain('sharp at the end');
    // Stored on the shot.
    const stored = (await call('GET', `/shots/${shot.id}`)).data;
    expect(stored.advice.source).toBe('ai');
  });

  it('rejects two changes at once and keeps the engine advice (rule R6)', async () => {
    const shot = await sourShot();
    replies.push({ parsed_output: { adjustment: 'grind_finer', diagnosis: 'under', headline: 'x', explanation: 'x', checks: [], promising: false, next: { ...next, grind_setting: 13, temperature_c: 94 } } });
    const r = await call('POST', `/shots/${shot.id}/advice`, { use_ai: true });
    expect(r.data.advice).toMatchObject({ source: 'engine', adjustment: 'increase_temp' });
    expect(r.data.ai_note).toMatch(/only one variable/);
  });
});

describe('AI: spend controls and status', () => {
  it('refuses without a key (503) and the app keeps working', async () => {
    const res = await app.request('/api/ai/analyze-beans', { method: 'POST', body: JSON.stringify({ image_id: 1 }), headers: { 'Content-Type': 'application/json' } }, { ...env, AUTH_DISABLED: 'true' });
    expect(res.status).toBe(503);
  });

  it('enforces the daily cap and logs the blocked call', async () => {
    const today = (await call('GET', '/status')).data.ai_calls_today;
    expect(today).toBeGreaterThan(0);
    const img = await upload('beans');
    const r = await call('POST', '/ai/analyze-beans', { image_id: img.id }, { AI_DAILY_CALL_LIMIT: String(today) });
    expect(r.status).toBe(429);
    expect(calls).toHaveLength(0); // never reached Claude
    const row = await env.DB.prepare('SELECT outcome FROM ai_usage ORDER BY id DESC').first<any>();
    expect(row.outcome).toBe('blocked_by_cap');
    expect((await call('GET', '/status')).data.ai_calls_today).toBe(today); // blocked calls don't count
  });

  it('reports a reached Anthropic spend limit clearly', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const img = await upload('beans');
    replies.push({ throws: new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', details: { error_code: 'enforced_spend_limit_reached' } } }, 'limit', new Headers()) });
    const r = await call('POST', '/ai/analyze-beans', { image_id: img.id });
    expect(r.status).toBe(503);
    expect(r.data.error).toMatch(/spend limit/);
  });

  it('status shows month-to-date calls and cost', async () => {
    const s = (await call('GET', '/status')).data;
    expect(s.ai_configured).toBe(true);
    expect(s.ai_calls_month).toBeGreaterThan(0);
    expect(s.ai_cost_month_usd).toBeGreaterThan(0);
  });
});
