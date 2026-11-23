// AI adapter (spec §9). Implemented in milestone M4; until then every call reports
// "not available" and the app keeps working with the deterministic engine (rule R9).

import { HTTPException } from 'hono/http-exception';
import type { Advice, BrewPreferences, Coffee, EquipmentLimits, Recipe, Shot } from '../../shared/types';
import type { RecipeSuggestion } from '../../shared/engine';

export function aiConfigured(env: Env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

function unavailable(): never {
  throw new HTTPException(503, { message: 'AI features are not available yet. Everything else works without them.' });
}

export async function refineRecipeWithAi(
  _env: Env,
  _input: { coffee: Coffee; engine: RecipeSuggestion; shots: Shot[]; prefs: BrewPreferences },
): Promise<RecipeSuggestion> {
  return unavailable();
}

export async function reviewAdviceWithAi(
  _env: Env,
  _input: { coffee: Coffee; recipe: Recipe | null; shot: Shot; history: Shot[]; engine: Advice; limits: EquipmentLimits },
): Promise<{ advice: Advice; note?: string }> {
  return unavailable();
}
