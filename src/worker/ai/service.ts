// AI features (spec §9): packaging extraction, bean analysis, recipe refinement, advice review.
// The model only proposes; everything is validated here before it can reach the database,
// and the deterministic engine remains the fallback (rules R4, R6, R9).

import { HTTPException } from 'hono/http-exception';
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type {
  Advice, BeanObservation, BrewPreferences, Coffee, EquipmentLimits, PackagingDraft, Recipe, RecipeParams, Shot,
} from '../../shared/types';
import { DEFAULT_LIMITS } from '../../shared/types';
import { nextShotBaseline, recipeBoundsProblems, type RecipeSuggestion, validateAiAdvice } from '../../shared/engine';
import { checkStatedRatio } from '../../shared/ratio';
import { callStructured, imageBlock } from './client';
import { adviceSchema, beansSchema, packagingSchema, refineSchema } from './schemas';
import { ANALYZE_BEANS, EXTRACT_PACKAGING, REFINE_RECIPE, REVIEW_ADVICE } from './prompts';

export { aiConfigured } from './client';

const visionModel = (env: Env) => env.MODEL_VISION || 'claude-sonnet-5-5';
const textModel = (env: Env) => env.MODEL_TEXT || 'claude-haiku-5-5';
const text = (t: string): BetaContentBlockParam => ({ type: 'text', text: t });

// ---------------------------------------------------------------------------
// Packaging extraction
// ---------------------------------------------------------------------------

const TEXT_FIELDS = ['name', 'brand', 'product', 'origin_country', 'region', 'farm', 'variety', 'processing', 'altitude', 'intensity'] as const;
const clean = (s: string | null | undefined) => {
  const t = (s ?? '').trim();
  return t && !/^(unknown|n\/a|none|not stated|not printed)$/i.test(t) ? t : null;
};

export async function extractPackaging(env: Env, images: Array<{ r2_key: string; content_type: string }>, typed?: string | null): Promise<{ draft: PackagingDraft; raw: unknown }> {
  if (!images.length) throw new HTTPException(400, { message: 'Add at least one photo of the bag.' });
  const content: BetaContentBlockParam[] = [];
  for (const img of images.slice(0, 4)) content.push(await imageBlock(env, img.r2_key, img.content_type));
  content.push(text(typed?.trim()
    ? `Text the user typed from the bag (treat as printed text):\n${typed.trim()}\n\nExtract the coffee details.`
    : 'Extract the coffee details from these packaging photos.'));

  const { output } = await callStructured(env, {
    task: 'extract_packaging', model: visionModel(env), system: EXTRACT_PACKAGING, content,
    schema: packagingSchema, maxTokens: 16000, effort: 'medium',
  });

  const draft: PackagingDraft = { fields: {}, evidence: {}, tasting_notes: [], packaging_recipe: null, ratio_check: null, raw_text: output.raw_text, uncertainties: [...output.uncertainties] };
  for (const f of TEXT_FIELDS) {
    const v = clean(output[f].value);
    if (v) { draft.fields[f] = v; draft.evidence[f] = output[f].evidence ?? v; }
  }
  if (output.roast_level.value) { draft.fields.roast_level = output.roast_level.value; draft.evidence.roast_level = output.roast_level.evidence ?? ''; }
  const date = clean(output.roast_date.value);
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date))) {
    draft.fields.roast_date = date;
    draft.evidence.roast_date = output.roast_date.evidence ?? date;
  } else if (date) {
    draft.uncertainties.push(`Roast date "${output.roast_date.evidence ?? date}" isn't a full date, so it was left empty.`);
  }
  const cup = output.cupping_score.value;
  if (cup != null && cup > 0 && cup <= 100) { draft.fields.cupping_score = cup; draft.evidence.cupping_score = output.cupping_score.evidence ?? String(cup); }
  draft.tasting_notes = Array.from(new Set(output.tasting_notes.map((t) => t.trim().toLowerCase()).filter(Boolean))).slice(0, 30);
  if (draft.tasting_notes.length) draft.evidence.tasting_notes = draft.tasting_notes.join(', ');

  const pr = output.packaging_recipe;
  if (pr && pr.dose_g != null && pr.yield_g != null && pr.dose_g > 0 && pr.yield_g > 0) {
    draft.packaging_recipe = pr;
    draft.ratio_check = checkStatedRatio(pr.dose_g, pr.yield_g, pr.stated_ratio);
  }
  return { draft, raw: output };
}

// ---------------------------------------------------------------------------
// Bean photo analysis
// ---------------------------------------------------------------------------

export async function analyzeBeans(env: Env, image: { r2_key: string; content_type: string }): Promise<BeanObservation> {
  const { output } = await callStructured(env, {
    task: 'analyze_beans', model: visionModel(env), system: ANALYZE_BEANS,
    content: [await imageBlock(env, image.r2_key, image.content_type), text('Describe these beans.')],
    schema: beansSchema, maxTokens: 8000, effort: 'medium',
  });
  return output;
}

// ---------------------------------------------------------------------------
// Recipe refinement ("Ask the barista" on the recipe card)
// ---------------------------------------------------------------------------

function coffeeFacts(c: Coffee) {
  const facts: Record<string, unknown> = {};
  for (const k of ['name', 'brand', 'product', 'origin_country', 'region', 'variety', 'processing', 'roast_level', 'roast_date', 'altitude', 'intensity', 'cupping_score', 'tasting_notes'] as const) {
    const v = c[k];
    if (v == null || (Array.isArray(v) && !v.length)) continue;
    facts[k] = { value: v, source: c.field_sources[k] ?? 'unknown' };
  }
  return facts;
}

function shotForPrompt(s: Shot) {
  return {
    pulled_at: s.pulled_at.slice(0, 16), dose_g: s.dose_g, yield_g: s.yield_g, ratio: Number(s.ratio.toFixed(2)), time_s: s.time_s,
    temperature_c: s.temperature_c, preinfusion_s: s.preinfusion_s, grind: s.grind_setting, inner_burr: s.grind_inner,
    tags: s.taste_tags, score: s.score, feedback: s.feedback, notes: s.notes,
  };
}

export async function refineRecipeWithAi(
  env: Env,
  input: { coffee: Coffee; engine: RecipeSuggestion; shots: Shot[]; prefs: BrewPreferences },
): Promise<RecipeSuggestion & { note?: string }> {
  const context = {
    coffee: coffeeFacts(input.coffee),
    unknown_facts_are_unknown: true,
    engine_recipe: { ...input.engine.params, rationale: input.engine.rationale },
    preferences: input.prefs,
    recent_shots: input.shots.slice(0, 10).map(shotForPrompt),
  };
  const { output } = await callStructured(env, {
    task: 'refine_recipe', model: visionModel(env), system: REFINE_RECIPE,
    content: [text(`${JSON.stringify(context, null, 1)}\n\nReturn the starting recipe.`)],
    schema: refineSchema, maxTokens: 8000, effort: 'medium',
  });
  // Grind numbers are bean-specific: the AI never sets them; keep the engine's (from your own history).
  const params: RecipeParams = {
    ...output,
    grind_setting: input.engine.params.grind_setting,
    grind_inner: input.engine.params.grind_inner,
  };
  const problems = recipeBoundsProblems(params);
  if (problems.length) {
    return { ...input.engine, note: `The AI's recipe was outside the allowed range (${problems.join('; ')}), so the built-in recipe was kept.` };
  }
  return { params, rationale: output.rationale };
}

// ---------------------------------------------------------------------------
// Advice review (after a shot)
// ---------------------------------------------------------------------------

export async function reviewAdviceWithAi(
  env: Env,
  input: { coffee: Coffee; recipe: Recipe | null; shot: Shot; history: Shot[]; engine: Advice; limits: EquipmentLimits; prefs: BrewPreferences },
): Promise<{ advice: Advice; note?: string }> {
  // Validate against the same baseline the engine used (recipe + grind actually used).
  const baseline = nextShotBaseline(input.shot, input.recipe ? recipeParamsOf(input.recipe) : null, input.prefs);
  const context = {
    coffee: coffeeFacts(input.coffee),
    recipe_aimed_for: input.recipe ? { version: input.recipe.version, ...baseline } : null,
    baseline_for_next_shot: baseline,
    latest_shot: shotForPrompt(input.shot),
    earlier_shots: input.history.filter((s) => s.id !== input.shot.id).slice(0, 9).map(shotForPrompt),
    engine_advice: { adjustment: input.engine.adjustment, headline: input.engine.headline, explanation: input.engine.explanation, next: input.engine.next },
    limits: { ...DEFAULT_LIMITS, ...input.limits },
  };
  const { output } = await callStructured(env, {
    task: 'review_advice', model: textModel(env), system: REVIEW_ADVICE,
    content: [text(`${JSON.stringify(context, null, 1)}\n\nReturn the advice for the next shot.`)],
    schema: adviceSchema, maxTokens: 8000, effort: 'low',
  });
  const result = validateAiAdvice(input.engine, baseline, output, input.limits);
  if (!result.accepted) {
    return { advice: input.engine, note: `The AI's suggestion didn't pass the checks (${result.reason}), so the built-in advice is shown.` };
  }
  return { advice: result.advice };
}

function recipeParamsOf(r: Recipe): RecipeParams {
  return {
    dose_g: r.dose_g, yield_g: r.yield_g, temperature_c: r.temperature_c, time_min_s: r.time_min_s, time_max_s: r.time_max_s,
    preinfusion_min_s: r.preinfusion_min_s, preinfusion_max_s: r.preinfusion_max_s, grind_setting: r.grind_setting, grind_inner: r.grind_inner,
  };
}
