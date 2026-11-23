// Domain types shared by the server and the web client.

export const ROAST_LEVELS = ['light', 'light-medium', 'medium', 'medium-dark', 'dark'] as const;
export type RoastLevel = (typeof ROAST_LEVELS)[number];

/**
 * Where a coffee fact came from. Kept per field so the UI can always show
 * whether something is confirmed or only estimated.
 *  - packaging:  printed on the bag / product information
 *  - visual:     estimated from a photo of the beans (never a confirmed fact)
 *  - user:       entered or confirmed by you
 *  - historical: imported from earlier notes, not re-verified
 */
export const FIELD_SOURCES = ['packaging', 'visual', 'user', 'historical'] as const;
export type FieldSource = (typeof FIELD_SOURCES)[number];

/**
 * historical: imported record, NOT confirmed as in stock
 * active:     currently in use / in stock
 * finished:   bag is done, history kept
 * archived:   hidden from the dashboard, history kept
 */
export const COFFEE_STATUSES = ['active', 'historical', 'finished', 'archived'] as const;
export type CoffeeStatus = (typeof COFFEE_STATUSES)[number];

export const SOURCED_FIELDS = [
  'name', 'brand', 'product', 'origin_country', 'region', 'farm', 'variety', 'processing',
  'roast_level', 'roast_date', 'tasting_notes', 'cupping_score', 'intensity', 'altitude',
] as const;
export type SourcedField = (typeof SOURCED_FIELDS)[number];

export interface Coffee {
  id: number;
  name: string;
  brand: string | null;
  product: string | null;
  origin_country: string | null;
  region: string | null;
  farm: string | null;
  variety: string | null;
  processing: string | null;
  roast_level: RoastLevel | null;
  roast_date: string | null; // YYYY-MM-DD
  purchase_date: string | null;
  tasting_notes: string[];
  cupping_score: number | null;
  intensity: string | null;
  altitude: string | null;
  field_sources: Partial<Record<SourcedField, FieldSource>>;
  status: CoffeeStatus;
  remaining_g: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type CoffeeInput = Omit<Coffee, 'id' | 'created_at' | 'updated_at'>;

export const IMAGE_TYPES = ['packaging', 'beans', 'shot', 'other'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export interface BeanObservation {
  roast_estimate: RoastLevel | null;
  roast_estimate_note: string;
  colour_consistency: string;
  surface: string;
  oiliness: 'dry' | 'slight sheen' | 'some oil' | 'oily' | null;
  defects: string[];
  general: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface CoffeeImage {
  id: number;
  coffee_id: number | null;
  file_name: string;
  url: string;
  image_type: ImageType;
  ai_observations: BeanObservation | Record<string, unknown> | null;
  created_at: string;
}

export const RECIPE_STATUSES = ['suggested', 'active', 'superseded'] as const;
export type RecipeStatus = (typeof RECIPE_STATUSES)[number];

export const RECIPE_SOURCES = ['engine', 'ai', 'packaging', 'historical', 'user', 'dial-in'] as const;
export type RecipeSource = (typeof RECIPE_SOURCES)[number];

/** A recipe is a recommendation/configuration. It is never an actual extraction. */
export interface Recipe {
  id: number;
  coffee_id: number;
  version: number;
  dose_g: number;
  yield_g: number;
  ratio: number; // always yield_g / dose_g, computed by the database
  temperature_c: number;
  time_min_s: number;
  time_max_s: number;
  preinfusion_min_s: number | null;
  preinfusion_max_s: number | null;
  grinder_setting: string | null;
  rationale: string | null;
  source: RecipeSource;
  status: RecipeStatus;
  promising: boolean;
  based_on_shot_id: number | null;
  /** For packaging recipes: the ratio printed on the bag, kept to flag inconsistencies. */
  stated_ratio: number | null;
  created_at: string;
}

export type RecipeParams = Pick<
  Recipe,
  'dose_g' | 'yield_g' | 'temperature_c' | 'time_min_s' | 'time_max_s' | 'preinfusion_min_s' | 'preinfusion_max_s' | 'grinder_setting'
>;

export const TASTE_TAGS = [
  'sour', 'bitter', 'sweet', 'astringent', 'thin', 'heavy', 'balanced',
  'chocolate', 'fruity', 'nutty', 'caramel', 'too acidic', 'channeling',
] as const;
export type TasteTag = (typeof TASTE_TAGS)[number];

export const TASTE_TAG_LABELS: Record<TasteTag, string> = {
  sour: 'Sour',
  bitter: 'Bitter',
  sweet: 'Sweet',
  astringent: 'Dry / astringent',
  thin: 'Thin / watery',
  heavy: 'Heavy / intense',
  balanced: 'Balanced',
  chocolate: 'Chocolate',
  fruity: 'Fruity',
  nutty: 'Nutty',
  caramel: 'Caramel / toffee',
  'too acidic': 'Too acidic (but good)',
  channeling: 'Spurting / channeling',
};

/** An actual extraction. Never overwritten when a recipe changes. */
export interface Shot {
  id: number;
  coffee_id: number | null; // null = historical shot not attributed to a known coffee
  recipe_id: number | null;
  pulled_at: string;
  dose_g: number;
  yield_g: number;
  ratio: number;
  time_s: number;
  temperature_c: number | null;
  preinfusion_s: number | null;
  grinder_model: string | null;
  grinder_setting: string | null;
  basket: string | null;
  taste_tags: TasteTag[];
  score: number | null; // 1-5
  feedback: string | null;
  notes: string | null;
  photo_url: string | null;
  advice: Advice | null;
  created_at: string;
}

export type ShotInput = Omit<Shot, 'id' | 'ratio' | 'created_at' | 'advice' | 'photo_url'> & { photo_url?: string | null };

export const ADJUSTMENTS = [
  'grind_finer', 'grind_coarser', 'increase_temp', 'decrease_temp',
  'increase_yield', 'decrease_yield', 'puck_prep', 'keep',
] as const;
export type Adjustment = (typeof ADJUSTMENTS)[number];

export interface Advice {
  adjustment: Adjustment;
  headline: string;
  explanation: string;
  checks: string[];
  next: RecipeParams;
  diagnosis: 'under' | 'over' | 'uneven' | 'strength' | 'balance' | 'on-target' | 'time-only';
  promising: boolean;
  source: 'engine' | 'ai';
  engine_adjustment?: Adjustment; // when AI overrides the engine, keep the engine's call for traceability
}

export interface Equipment {
  id: number;
  equipment_type: 'machine' | 'grinder' | 'portafilter' | 'tamper' | 'accessory';
  brand: string;
  model: string;
  configuration: Record<string, unknown>;
  notes: string | null;
}

export interface BrewPreferences {
  dose_g: number;
  ratio: number;
  time_min_s: number;
  time_max_s: number;
  preinfusion_min_s: number;
  preinfusion_max_s: number;
  /** On the Smart Grinder Pro a LOWER number is finer. */
  grinder_lower_is_finer: boolean;
}

export const DEFAULT_PREFERENCES: BrewPreferences = {
  dose_g: 20,
  ratio: 2,
  time_min_s: 28,
  time_max_s: 32,
  preinfusion_min_s: 5,
  preinfusion_max_s: 8,
  grinder_lower_is_finer: true,
};

export interface CoffeeSummary {
  coffee: Coffee;
  current_recipe: Recipe | null;
  last_shot: Shot | null;
  best_shot: Shot | null;
  shot_count: number;
  avg_score: number | null;
  roast_age_days: number | null;
}
