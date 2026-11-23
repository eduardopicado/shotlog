// Domain types shared by the Worker (API) and the web client. See docs/SPEC.md §5.

export const ROAST_LEVELS = ['light', 'light-medium', 'medium', 'medium-dark', 'dark'] as const;
export type RoastLevel = (typeof ROAST_LEVELS)[number];

/**
 * Where a coffee fact came from (spec §6). Kept per field so the UI can always
 * show whether something is confirmed or only estimated.
 */
export const FIELD_SOURCES = ['packaging', 'visual', 'user', 'historical'] as const;
export type FieldSource = (typeof FIELD_SOURCES)[number];

export const COFFEE_STATUSES = ['active', 'historical', 'finished', 'archived'] as const;
export type CoffeeStatus = (typeof COFFEE_STATUSES)[number];

export const SOURCED_FIELDS = [
  'name', 'brand', 'product', 'origin_country', 'region', 'farm', 'variety', 'processing',
  'roast_level', 'roast_date', 'tasting_notes', 'cupping_score', 'intensity', 'altitude',
] as const;
export type SourcedField = (typeof SOURCED_FIELDS)[number];
export type FieldSources = Partial<Record<SourcedField, FieldSource>>;

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
  roast_date: string | null; // YYYY-MM-DD, exact dates only
  purchase_date: string | null;
  tasting_notes: string[];
  cupping_score: number | null;
  intensity: string | null;
  altitude: string | null;
  field_sources: FieldSources;
  status: CoffeeStatus;
  remaining_g: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const IMAGE_TYPES = ['packaging', 'beans', 'shot', 'other'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export const OILINESS = ['dry', 'slight sheen', 'some oil', 'oily'] as const;

export interface BeanObservation {
  roast_estimate: RoastLevel | null;
  roast_estimate_note: string;
  colour_consistency: string;
  surface: string;
  oiliness: (typeof OILINESS)[number] | null;
  defects: string[];
  general: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface CoffeeImage {
  id: number;
  coffee_id: number | null;
  image_type: ImageType;
  url: string; // /api/images/:id/file
  ai_observations: unknown | null;
  created_at: string;
}

export const RECIPE_STATUSES = ['suggested', 'active', 'superseded'] as const;
export type RecipeStatus = (typeof RECIPE_STATUSES)[number];

export const RECIPE_SOURCES = ['engine', 'ai', 'packaging', 'historical', 'user', 'dial-in'] as const;
export type RecipeSource = (typeof RECIPE_SOURCES)[number];

/** The parameters that define how to pull a shot. */
export interface RecipeParams {
  dose_g: number;
  yield_g: number;
  temperature_c: number | null; // null only for printed recipes that gave no temperature
  time_min_s: number;
  time_max_s: number;
  preinfusion_min_s: number | null;
  preinfusion_max_s: number | null;
  grind_setting: number | null; // Smart Grinder Pro dial, lower = finer
  grind_inner: number | null;   // inner burr, optional
}

/** A recipe is a plan/recommendation. It is never an actual extraction (rule R3). */
export interface Recipe extends RecipeParams {
  id: number;
  coffee_id: number;
  version: number;
  ratio: number; // yield_g / dose_g, computed by the database
  rationale: string | null;
  source: RecipeSource;
  status: RecipeStatus;
  promising: boolean;
  stated_ratio: number | null;
  based_on_shot_id: number | null;
  created_at: string;
}

export const TASTE_TAGS = [
  'sour', 'bitter', 'sweet', 'astringent', 'thin', 'heavy', 'balanced', 'too acidic', 'channeling',
  'chocolate', 'fruity', 'nutty', 'caramel',
] as const;
export type TasteTag = (typeof TASTE_TAGS)[number];

/** Tags that describe extraction/balance (drive adjustments) vs flavour notes (recorded only). */
export const BALANCE_TAGS: TasteTag[] = ['sour', 'bitter', 'sweet', 'astringent', 'thin', 'heavy', 'balanced', 'too acidic', 'channeling'];
export const FLAVOUR_TAGS: TasteTag[] = ['chocolate', 'fruity', 'nutty', 'caramel'];

export const TASTE_TAG_LABELS: Record<TasteTag, string> = {
  sour: 'Sour',
  bitter: 'Bitter',
  sweet: 'Sweet',
  astringent: 'Dry / astringent',
  thin: 'Thin / watery',
  heavy: 'Heavy / intense',
  balanced: 'Balanced',
  'too acidic': 'Too acidic (but good)',
  channeling: 'Spurting / channeling',
  chocolate: 'Chocolate',
  fruity: 'Fruity',
  nutty: 'Nutty',
  caramel: 'Caramel / toffee',
};

export interface ShotFields {
  dose_g: number;
  yield_g: number;
  time_s: number; // total time including pre-infusion
  temperature_c: number | null;
  preinfusion_s: number | null;
  grind_setting: number | null;
  grind_inner: number | null;
  taste_tags: TasteTag[];
  score: number | null; // 1-5
}

/** An actual extraction (rule R3). */
export interface Shot extends ShotFields {
  id: number;
  coffee_id: number | null; // null = historical shot, coffee unknown
  recipe_id: number | null;
  pulled_at: string;
  ratio: number;
  grinder_model: string | null;
  basket: string | null;
  feedback: string | null;
  notes: string | null;
  photo_image_id: number | null;
  advice: Advice | null;
  created_at: string;
}

export const ADJUSTMENTS = [
  'grind_finer', 'grind_coarser', 'increase_temp', 'decrease_temp',
  'increase_yield', 'decrease_yield', 'puck_prep', 'keep',
] as const;
export type Adjustment = (typeof ADJUSTMENTS)[number];

export const DIAGNOSES = ['under', 'over', 'uneven', 'strength', 'balance', 'on-target', 'time-only'] as const;
export type Diagnosis = (typeof DIAGNOSES)[number];

export interface Advice {
  adjustment: Adjustment;
  diagnosis: Diagnosis;
  /** Which rule of the decision table (spec §8.3) produced this, for traceability. */
  rule: number | null;
  headline: string;
  explanation: string;
  checks: string[];
  next: RecipeParams;
  promising: boolean;
  source: 'engine' | 'ai';
  engine_adjustment?: Adjustment; // when AI differs from the engine, the engine's original call
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
}

export const DEFAULT_PREFERENCES: BrewPreferences = {
  dose_g: 20,
  ratio: 2,
  time_min_s: 28,
  time_max_s: 32,
  preinfusion_min_s: 5,
  preinfusion_max_s: 8,
};

/** Machine and grinder limits used by the engine (Breville Dual Boiler + Smart Grinder Pro). */
export interface EquipmentLimits {
  temp_min: number;
  temp_max: number;
  grind_min: number;
  grind_max: number;
  lower_is_finer: boolean;
}

export const DEFAULT_LIMITS: EquipmentLimits = {
  temp_min: 86,
  temp_max: 96,
  grind_min: 1,
  grind_max: 60,
  lower_is_finer: true,
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

export interface CoffeeDetail extends CoffeeSummary {
  images: CoffeeImage[];
  recipes: Recipe[];
  shots: Shot[];
}

export interface Dashboard {
  active: CoffeeSummary[];
  recent: CoffeeSummary[];
  last_shot: (Shot & { coffee_name: string | null }) | null;
  historical_count: number;
  unassigned_shot_count: number;
}

/** Result of reading a bag with AI, for the review screen. Only fields that were printed are present. */
export interface PackagingDraft {
  fields: Partial<{
    name: string; brand: string; product: string; origin_country: string; region: string; farm: string; variety: string;
    processing: string; roast_level: RoastLevel; roast_date: string; altitude: string; intensity: string; cupping_score: number;
  }>;
  evidence: Partial<Record<SourcedField, string>>;
  tasting_notes: string[];
  packaging_recipe: { dose_g: number | null; yield_g: number | null; stated_ratio: number | null; time_s: number | null; temperature_c: number | null } | null;
  ratio_check: { consistent: boolean; actualRatio: number; message: string | null; yieldForStated: number | null } | null;
  raw_text: string;
  uncertainties: string[];
}

export interface AppStatus {
  version: string;
  ai_configured: boolean;
  ai_calls_today: number;
  ai_daily_limit: number;
  ai_cost_month_usd: number;
  ai_calls_month: number;
}
