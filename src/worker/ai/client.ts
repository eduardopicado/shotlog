// Claude API client for Shotlog (spec §9). Every call goes through `callStructured`, which:
//   1. refuses when no key is set (the app keeps working without AI, rule R9),
//   2. enforces the daily call cap (rule R10),
//   3. asks for structured JSON validated by a Zod schema,
//   4. logs tokens and an estimated cost to `ai_usage`,
//   5. turns refusals, spend-limit errors and bad output into clear messages.

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';

export type AiTask = 'extract_packaging' | 'analyze_beans' | 'refine_recipe' | 'review_advice';
type Outcome = 'ok' | 'invalid_output' | 'refused' | 'error' | 'blocked_by_cap';

/** List prices in USD per million tokens (input, output), used for the in-app estimate only. */
const PRICES: Record<string, [number, number]> = {
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5': [2, 10],
  'claude-opus-4-8': [5, 25],
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const [pin, pout] = PRICES[model] ?? PRICES['claude-sonnet-5-5'];
  return (inputTokens * pin + outputTokens * pout) / 1_000_000;
}

/** The slice of the SDK client we use — lets tests inject a fake. */
export interface AiClient {
  beta: { messages: { parse: Anthropic['beta']['messages']['parse'] } };
}

let clientFactory: (env: Env) => AiClient = (env) =>
  new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined, maxRetries: 2, timeout: 90_000 });

/** Test hook: replace the Claude client. */
export function setAiClientFactory(factory: (env: Env) => AiClient): void {
  clientFactory = factory;
}

export function aiConfigured(env: Env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

async function logUsage(db: D1Database, task: AiTask, model: string | null, input: number, output: number, outcome: Outcome) {
  await db.prepare('INSERT INTO ai_usage (task, model, input_tokens, output_tokens, est_cost_usd, outcome) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(task, model, input, output, model ? estimateCost(model, input, output) : 0, outcome).run();
}

export async function callsToday(db: D1Database): Promise<number> {
  const r = await db.prepare(
    "SELECT COUNT(*) AS n FROM ai_usage WHERE outcome != 'blocked_by_cap' AND called_at >= strftime('%Y-%m-%dT00:00:00', 'now')",
  ).first<{ n: number }>();
  return r?.n ?? 0;
}

export interface StructuredCall<S extends z.ZodType> {
  task: AiTask;
  model: string;
  system: string;
  content: BetaContentBlockParam[];
  schema: S;
  maxTokens: number;
  effort: 'low' | 'medium' | 'high';
}

export async function callStructured<S extends z.ZodType>(env: Env, call: StructuredCall<S>): Promise<{ output: z.output<S>; model: string }> {
  if (!aiConfigured(env)) {
    throw new HTTPException(503, { message: 'AI is not connected. Add an ANTHROPIC_API_KEY secret to use it; everything else works without it.' });
  }
  const db = env.DB;
  const limit = Number(env.AI_DAILY_CALL_LIMIT) || 30;
  if ((await callsToday(db)) >= limit) {
    await logUsage(db, call.task, null, 0, 0, 'blocked_by_cap');
    throw new HTTPException(429, { message: `Daily AI limit reached (${limit} calls). It resets at midnight UTC; the built-in advice still works.` });
  }

  // Sonnet/Opus 5.5: if the model declines for policy reasons, the API retries on a fallback model in the same call.
  const supportsFallback = /^claude-(sonnet|opus)-5-5/.test(call.model);
  let response;
  try {
    response = await clientFactory(env).beta.messages.parse({
      model: call.model,
      max_tokens: call.maxTokens,
      system: call.system,
      messages: [{ role: 'user', content: call.content }],
      output_config: { format: betaZodOutputFormat(call.schema), effort: call.effort },
      ...(supportsFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    });
  } catch (err) {
    await logUsage(db, call.task, call.model, 0, 0, 'error');
    throw toHttpError(err);
  }

  const usage = response.usage;
  const input = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  const output = usage.output_tokens ?? 0;
  const served = response.model ?? call.model;

  if (response.stop_reason === 'refusal') {
    await logUsage(db, call.task, served, input, output, 'refused');
    throw new HTTPException(422, { message: 'The AI declined this request. Use the manual path or try a different photo.' });
  }
  const parsed = response.stop_reason === 'max_tokens' ? null : response.parsed_output;
  const checked = parsed == null ? null : call.schema.safeParse(parsed);
  if (!checked?.success) {
    await logUsage(db, call.task, served, input, output, 'invalid_output');
    throw new HTTPException(502, { message: 'The AI returned an unusable answer. Try again, or continue manually.' });
  }
  await logUsage(db, call.task, served, input, output, 'ok');
  return { output: checked.data as z.output<S>, model: served };
}

function toHttpError(err: unknown): HTTPException {
  if (err instanceof HTTPException) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new HTTPException(503, { message: 'The Claude API key was rejected. Check the ANTHROPIC_API_KEY secret.' });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new HTTPException(429, { message: 'Claude is rate-limiting requests right now. Try again in a minute.' });
  }
  if (err instanceof Anthropic.APIError) {
    if (JSON.stringify(err.error ?? '').includes('enforced_spend_limit_reached')) {
      return new HTTPException(503, { message: 'AI unavailable: your Anthropic spend limit has been reached. Everything else keeps working.' });
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return new HTTPException(503, { message: 'Could not reach the Claude API. Try again shortly.' });
    }
    return new HTTPException(502, { message: `Claude API error${err.status ? ` (${err.status})` : ''}. Try again, or continue manually.` });
  }
  console.error('AI call failed', err);
  return new HTTPException(502, { message: 'The AI request failed. Try again, or continue manually.' });
}

/** Image content block from a photo stored in R2. */
export async function imageBlock(env: Env, r2Key: string, contentType: string): Promise<BetaContentBlockParam> {
  const obj = await env.PHOTOS.get(r2Key);
  if (!obj) throw new HTTPException(404, { message: 'Photo file not found' });
  const data = Buffer.from(await obj.arrayBuffer()).toString('base64'); // native, cheap on Worker CPU
  return {
    type: 'image',
    source: { type: 'base64', media_type: contentType as 'image/jpeg' | 'image/png' | 'image/webp', data },
  };
}
