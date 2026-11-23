// Output schemas for the AI calls (spec §9.2). Kept to the JSON-schema subset that
// structured outputs support (objects, enums, nullable, arrays); numeric bounds are
// enforced afterwards by the engine's own validation, not by the schema.

import { z } from 'zod';
import { ADJUSTMENTS, DIAGNOSES, OILINESS, ROAST_LEVELS } from '../../shared/types';

const fact = z.object({
  value: z.string().nullable().describe('Exactly as printed, or null if not printed'),
  evidence: z.string().nullable().describe('The short text you read that supports the value'),
});

export const packagingSchema = z.object({
  name: fact,
  brand: fact,
  product: fact,
  origin_country: fact,
  region: fact,
  farm: fact,
  variety: fact,
  processing: fact,
  roast_level: z.object({ value: z.enum(ROAST_LEVELS).nullable(), evidence: z.string().nullable() }),
  roast_date: z.object({ value: z.string().nullable().describe('YYYY-MM-DD only if a full unambiguous date is printed'), evidence: z.string().nullable() }),
  altitude: fact,
  intensity: fact,
  cupping_score: z.object({ value: z.number().nullable(), evidence: z.string().nullable() }),
  tasting_notes: z.array(z.string()),
  packaging_recipe: z.object({
    dose_g: z.number().nullable(),
    yield_g: z.number().nullable(),
    stated_ratio: z.number().nullable().describe('The printed ratio as a number, e.g. 2.25 for 1:2.25'),
    time_s: z.number().nullable(),
    temperature_c: z.number().nullable(),
  }).nullable(),
  raw_text: z.string(),
  uncertainties: z.array(z.string()),
});
export type PackagingOutput = z.infer<typeof packagingSchema>;

export const beansSchema = z.object({
  roast_estimate: z.enum(ROAST_LEVELS).nullable(),
  roast_estimate_note: z.string(),
  colour_consistency: z.string(),
  surface: z.string(),
  oiliness: z.enum(OILINESS).nullable(),
  defects: z.array(z.string()),
  general: z.string(),
  confidence: z.enum(['low', 'medium', 'high']),
});

export const refineSchema = z.object({
  dose_g: z.number(),
  yield_g: z.number(),
  temperature_c: z.number(),
  time_min_s: z.number(),
  time_max_s: z.number(),
  preinfusion_min_s: z.number().nullable(),
  preinfusion_max_s: z.number().nullable(),
  rationale: z.string(),
});

export const adviceSchema = z.object({
  adjustment: z.enum(ADJUSTMENTS),
  diagnosis: z.enum(DIAGNOSES),
  headline: z.string(),
  explanation: z.string(),
  checks: z.array(z.string()),
  promising: z.boolean(),
  next: z.object({
    dose_g: z.number(),
    yield_g: z.number(),
    temperature_c: z.number(),
    time_min_s: z.number(),
    time_max_s: z.number(),
    preinfusion_min_s: z.number().nullable(),
    preinfusion_max_s: z.number().nullable(),
    grind_setting: z.number().nullable(),
    grind_inner: z.number().nullable(),
  }),
});
