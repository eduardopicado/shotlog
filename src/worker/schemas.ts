// Request body schemas (Zod). Every API input is validated here.

import { z } from 'zod';
import { COFFEE_STATUSES, FIELD_SOURCES, IMAGE_TYPES, ROAST_LEVELS, SOURCED_FIELDS, TASTE_TAGS } from '../shared/types';

const nullableText = z.string().trim().max(2000).transform((s) => (s === '' ? null : s)).nullable();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable();
const grams = z.number().positive().max(200);
const seconds = z.number().nonnegative().max(300);

export const fieldSourcesSchema = z.partialRecord(z.enum(SOURCED_FIELDS), z.enum(FIELD_SOURCES));

export const coffeeFields = {
  name: z.string().trim().min(1).max(200),
  brand: nullableText,
  product: nullableText,
  origin_country: nullableText,
  region: nullableText,
  farm: nullableText,
  variety: nullableText,
  processing: nullableText,
  roast_level: z.enum(ROAST_LEVELS).nullable(),
  roast_date: isoDate,
  purchase_date: isoDate,
  tasting_notes: z.array(z.string().trim().min(1).max(100)).max(40),
  cupping_score: z.number().min(0).max(100).nullable(),
  intensity: nullableText,
  altitude: nullableText,
  status: z.enum(COFFEE_STATUSES),
  remaining_g: z.number().nonnegative().max(10000).nullable(),
  notes: z.string().max(5000).nullable(),
};

export const createCoffeeSchema = z.object({
  ...coffeeFields,
  status: coffeeFields.status.default('active'),
  tasting_notes: coffeeFields.tasting_notes.default([]),
  field_sources: fieldSourcesSchema.default({}),
  image_ids: z.array(z.number().int().positive()).max(20).default([]),
}).partial({
  brand: true, product: true, origin_country: true, region: true, farm: true, variety: true, processing: true,
  roast_level: true, roast_date: true, purchase_date: true, cupping_score: true, intensity: true, altitude: true,
  remaining_g: true, notes: true,
});

export const updateCoffeeSchema = z.object({ ...coffeeFields, field_sources: fieldSourcesSchema }).partial();

export const recipeParamsSchema = z.object({
  dose_g: grams,
  yield_g: grams,
  temperature_c: z.number().min(70).max(100).nullable(),
  time_min_s: seconds,
  time_max_s: seconds,
  preinfusion_min_s: seconds.nullable(),
  preinfusion_max_s: seconds.nullable(),
  grind_setting: z.number().min(0).max(100).nullable(),
  grind_inner: z.number().int().min(0).max(20).nullable(),
}).refine((r) => r.time_min_s <= r.time_max_s, { message: 'time_min_s must be ≤ time_max_s' });

export const createRecipeSchema = z.object({
  params: recipeParamsSchema,
  rationale: z.string().max(2000).nullable().default(null),
  source: z.enum(['user', 'packaging']).default('user'),
  stated_ratio: z.number().positive().max(10).nullable().default(null),
  activate: z.boolean().default(false),
});

export const suggestRecipeSchema = z.object({ use_ai: z.boolean().default(false) });

const shotFields = {
  coffee_id: z.number().int().positive().nullable(),
  recipe_id: z.number().int().positive().nullable(),
  pulled_at: z.iso.datetime({ offset: true }),
  dose_g: grams,
  yield_g: grams,
  time_s: z.number().positive().max(300),
  temperature_c: z.number().min(70).max(100).nullable(),
  preinfusion_s: seconds.nullable(),
  grind_setting: z.number().min(0).max(100).nullable(),
  grind_inner: z.number().int().min(0).max(20).nullable(),
  basket: nullableText,
  taste_tags: z.array(z.enum(TASTE_TAGS)).max(TASTE_TAGS.length),
  score: z.number().int().min(1).max(5).nullable(),
  feedback: z.string().max(2000).nullable(),
  notes: z.string().max(2000).nullable(),
  photo_image_id: z.number().int().positive().nullable(),
};

export const createShotSchema = z.object({
  ...shotFields,
  coffee_id: z.number().int().positive(),
  mark_active: z.boolean().default(false),
}).partial({
  recipe_id: true, pulled_at: true, temperature_c: true, preinfusion_s: true, grind_setting: true, grind_inner: true,
  basket: true, taste_tags: true, score: true, feedback: true, notes: true, photo_image_id: true,
});

export const updateShotSchema = z.object(shotFields).partial();

export const adviceRequestSchema = z.object({ use_ai: z.boolean().default(false) });

export const preferencesSchema = z.object({
  dose_g: grams,
  ratio: z.number().min(1).max(4),
  time_min_s: seconds,
  time_max_s: seconds,
  preinfusion_min_s: seconds,
  preinfusion_max_s: seconds,
});

export const equipmentUpdateSchema = z.object({
  brand: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(200),
  configuration: z.record(z.string(), z.unknown()),
  notes: z.string().max(1000).nullable(),
}).partial();

export const imageUpdateSchema = z.object({
  coffee_id: z.number().int().positive().nullable(),
  image_type: z.enum(IMAGE_TYPES),
}).partial();
