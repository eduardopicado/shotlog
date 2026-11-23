import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY,
  equipment_type TEXT NOT NULL,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  configuration TEXT NOT NULL DEFAULT '{}',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS coffees (
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
  roast_date TEXT,
  purchase_date TEXT,
  tasting_notes TEXT NOT NULL DEFAULT '[]',
  cupping_score REAL,
  intensity TEXT,
  altitude TEXT,
  field_sources TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','historical','finished','archived')),
  remaining_g REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS coffee_images (
  id INTEGER PRIMARY KEY,
  coffee_id INTEGER REFERENCES coffees(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  image_type TEXT NOT NULL CHECK (image_type IN ('packaging','beans','shot','other')),
  ai_observations TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- A recipe is a recommendation/configuration, never an actual extraction.
CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY,
  coffee_id INTEGER NOT NULL REFERENCES coffees(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  dose_g REAL NOT NULL CHECK (dose_g > 0),
  yield_g REAL NOT NULL CHECK (yield_g > 0),
  ratio REAL GENERATED ALWAYS AS (yield_g / dose_g) VIRTUAL,
  temperature_c REAL NOT NULL,
  time_min_s REAL NOT NULL,
  time_max_s REAL NOT NULL,
  preinfusion_min_s REAL,
  preinfusion_max_s REAL,
  grinder_setting TEXT,
  rationale TEXT,
  source TEXT NOT NULL CHECK (source IN ('engine','ai','packaging','historical','user','dial-in')),
  status TEXT NOT NULL CHECK (status IN ('suggested','active','superseded')),
  promising INTEGER NOT NULL DEFAULT 0,
  based_on_shot_id INTEGER REFERENCES shots(id) ON DELETE SET NULL,
  stated_ratio REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (coffee_id, version)
);

-- A shot is an actual extraction. Rows are never rewritten when a recipe changes.
CREATE TABLE IF NOT EXISTS shots (
  id INTEGER PRIMARY KEY,
  coffee_id INTEGER REFERENCES coffees(id) ON DELETE SET NULL,
  recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  pulled_at TEXT NOT NULL,
  dose_g REAL NOT NULL CHECK (dose_g > 0),
  yield_g REAL NOT NULL CHECK (yield_g > 0),
  ratio REAL GENERATED ALWAYS AS (yield_g / dose_g) VIRTUAL,
  time_s REAL NOT NULL,
  temperature_c REAL,
  preinfusion_s REAL,
  grinder_model TEXT,
  grinder_setting TEXT,
  basket TEXT,
  taste_tags TEXT NOT NULL DEFAULT '[]',
  score INTEGER CHECK (score IS NULL OR score BETWEEN 1 AND 5),
  feedback TEXT,
  notes TEXT,
  photo_file TEXT,
  advice TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_shots_coffee ON shots(coffee_id, pulled_at);
CREATE INDEX IF NOT EXISTS idx_recipes_coffee ON recipes(coffee_id, version);
CREATE INDEX IF NOT EXISTS idx_images_coffee ON coffee_images(coffee_id);
`;

export function dataDir(): string {
  return path.resolve(process.env.SHOTLOG_DATA_DIR ?? 'data');
}

export function uploadsDir(): string {
  const dir = path.join(dataDir(), 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function openDb(file?: string): DB {
  const target = file ?? path.join(dataDir(), 'shotlog.db');
  if (target !== ':memory:') fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new Database(target);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
