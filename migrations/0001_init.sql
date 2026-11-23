-- Shotlog schema (spec §5). D1 / SQLite.
-- Ratios are GENERATED columns: they can never disagree with dose and yield (rule R1).

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL -- JSON
);

CREATE TABLE equipment (
  id INTEGER PRIMARY KEY,
  equipment_type TEXT NOT NULL CHECK (equipment_type IN ('machine','grinder','portafilter','tamper','accessory')),
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  configuration TEXT NOT NULL DEFAULT '{}', -- JSON
  notes TEXT
);

CREATE TABLE coffees (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  product TEXT,
  origin_country TEXT,
  region TEXT,
  farm TEXT,
  variety TEXT,
  processing TEXT,
  roast_level TEXT CHECK (roast_level IN ('light','light-medium','medium','medium-dark','dark')),
  roast_date TEXT,     -- YYYY-MM-DD, exact dates only
  purchase_date TEXT,  -- YYYY-MM-DD
  tasting_notes TEXT NOT NULL DEFAULT '[]', -- JSON array, as printed on the bag
  cupping_score REAL,
  intensity TEXT,
  altitude TEXT,
  field_sources TEXT NOT NULL DEFAULT '{}', -- JSON map field -> packaging|visual|user|historical
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','historical','finished','archived')),
  remaining_g REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE coffee_images (
  id INTEGER PRIMARY KEY,
  coffee_id INTEGER REFERENCES coffees(id) ON DELETE SET NULL,
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  image_type TEXT NOT NULL CHECK (image_type IN ('packaging','beans','shot','other')),
  ai_observations TEXT, -- JSON (packaging extraction or bean observation)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- A recipe is a plan/recommendation, never an actual extraction (rule R3).
CREATE TABLE recipes (
  id INTEGER PRIMARY KEY,
  coffee_id INTEGER NOT NULL REFERENCES coffees(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  dose_g REAL NOT NULL CHECK (dose_g > 0),
  yield_g REAL NOT NULL CHECK (yield_g > 0),
  ratio REAL GENERATED ALWAYS AS (yield_g / dose_g) VIRTUAL,
  temperature_c REAL,  -- NULL only when a printed recipe gave no temperature
  time_min_s REAL NOT NULL,
  time_max_s REAL NOT NULL,
  preinfusion_min_s REAL,
  preinfusion_max_s REAL,
  grind_setting REAL,   -- Smart Grinder Pro dial (1-60, lower = finer)
  grind_inner INTEGER,  -- Smart Grinder Pro inner burr (1-10), optional
  rationale TEXT,
  source TEXT NOT NULL CHECK (source IN ('engine','ai','packaging','historical','user','dial-in')),
  status TEXT NOT NULL CHECK (status IN ('suggested','active','superseded')),
  promising INTEGER NOT NULL DEFAULT 0,
  stated_ratio REAL,    -- packaging recipes: the ratio as printed, checked against dose/yield (rule R2)
  based_on_shot_id INTEGER REFERENCES shots(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (coffee_id, version)
);

-- A shot is an actual extraction (rule R3).
CREATE TABLE shots (
  id INTEGER PRIMARY KEY,
  coffee_id INTEGER REFERENCES coffees(id) ON DELETE SET NULL, -- NULL = historical shot, coffee unknown
  recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  pulled_at TEXT NOT NULL,
  dose_g REAL NOT NULL CHECK (dose_g > 0),
  yield_g REAL NOT NULL CHECK (yield_g > 0),
  ratio REAL GENERATED ALWAYS AS (yield_g / dose_g) VIRTUAL,
  time_s REAL NOT NULL CHECK (time_s > 0), -- total time including pre-infusion
  temperature_c REAL,
  preinfusion_s REAL,
  grinder_model TEXT,
  grind_setting REAL,
  grind_inner INTEGER,
  basket TEXT,
  taste_tags TEXT NOT NULL DEFAULT '[]', -- JSON array
  score INTEGER CHECK (score IS NULL OR score BETWEEN 1 AND 5),
  feedback TEXT,
  notes TEXT,
  photo_image_id INTEGER REFERENCES coffee_images(id) ON DELETE SET NULL,
  advice TEXT, -- JSON: the recommendation produced after this shot
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE ai_usage (
  id INTEGER PRIMARY KEY,
  called_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  task TEXT NOT NULL CHECK (task IN ('extract_packaging','analyze_beans','refine_recipe','review_advice')),
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  est_cost_usd REAL NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL CHECK (outcome IN ('ok','invalid_output','refused','error','blocked_by_cap'))
);

CREATE INDEX idx_shots_coffee ON shots(coffee_id, pulled_at);
CREATE INDEX idx_recipes_coffee ON recipes(coffee_id, version);
CREATE INDEX idx_images_coffee ON coffee_images(coffee_id);
CREATE INDEX idx_ai_usage_called ON ai_usage(called_at);
-- At most one active recipe per coffee.
CREATE UNIQUE INDEX idx_one_active_recipe ON recipes(coffee_id) WHERE status = 'active';
