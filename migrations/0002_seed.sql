-- Seed data from the handover (spec §13). Runs once per database.
-- All coffees are imported as HISTORICAL (not confirmed in stock, rule R7).
-- Historical recipes are suggestions, not confirmed results.

INSERT INTO settings (key, value) VALUES
  ('brew_preferences', '{"dose_g":20,"ratio":2,"time_min_s":28,"time_max_s":32,"preinfusion_min_s":5,"preinfusion_max_s":8}');

INSERT INTO equipment (id, equipment_type, brand, model, configuration, notes) VALUES
  (1, 'machine', 'Breville', 'Dual Boiler BES920BSS', '{"temp_min":86,"temp_max":96,"temp_step":1}', NULL),
  (2, 'grinder', 'Sage/Breville', 'Smart Grinder Pro', '{"dial_min":1,"dial_max":60,"lower_is_finer":true,"inner_burr_min":1,"inner_burr_max":10}', 'Grind settings are bean-specific; never universal.'),
  (3, 'portafilter', 'Breville', '58 mm portafilter', '{"diameter_mm":58,"basket_g":20}', 'Basket dose typically around 20 g.'),
  (4, 'tamper', 'Generic', '58.5 mm self-levelling tamper', '{"diameter_mm":58.5}', NULL),
  (5, 'accessory', 'Generic', 'WDT tool', '{}', NULL),
  (6, 'accessory', 'Generic', 'Puck screen', '{}', NULL);

-- 1. Ethiopia Karamo Single Origin
INSERT INTO coffees (id, name, origin_country, variety, processing, roast_level, roast_date, altitude, field_sources, status, notes) VALUES
  (1, 'Ethiopia Karamo Single Origin', 'Ethiopia', 'Arabica, Heirloom', 'Natural', 'light-medium', '2026-05-26', '≈2,000 m',
   '{"name":"historical","origin_country":"historical","variety":"historical","processing":"packaging","roast_level":"visual","roast_date":"historical","altitude":"historical"}',
   'historical',
   'Roast level visually estimated as light-medium to medium. Tasting notes not fully documented. The packaging espresso recommendation was internally inconsistent (printed 1:2.25 with 20 g in / 40 g out / 28 s).');

INSERT INTO recipes (coffee_id, version, dose_g, yield_g, temperature_c, time_min_s, time_max_s, source, status, stated_ratio, rationale) VALUES
  (1, 1, 20, 40, NULL, 28, 28, 'packaging', 'superseded', 2.25,
   'As printed on the packaging. Inconsistent: 20 g → 40 g is 1:2, not the printed 1:2.25 (a true 1:2.25 would be 45 g). No temperature was printed.');
INSERT INTO recipes (coffee_id, version, dose_g, yield_g, temperature_c, time_min_s, time_max_s, source, status, rationale) VALUES
  (1, 2, 20, 45, 94, 28, 32, 'historical', 'suggested',
   'Historical suggestion, not a confirmed result: explore about 20 g → 44–46 g at around 94 °C, 28–32 s.');

-- 2. Roosevelt Ethiopian Natural
INSERT INTO coffees (id, name, brand, origin_country, processing, field_sources, status, notes) VALUES
  (2, 'Roosevelt Ethiopian Natural', 'Roosevelt', 'Ethiopia', 'Natural',
   '{"name":"historical","brand":"historical","origin_country":"historical","processing":"historical"}',
   'historical',
   'Variety, roast date and roast level unknown. Do not infer a specific region or variety.');
INSERT INTO recipes (coffee_id, version, dose_g, yield_g, temperature_c, time_min_s, time_max_s, source, status, rationale) VALUES
  (2, 1, 20, 45, 94, 28, 32, 'historical', 'suggested',
   'Historical suggestion: about 94–95 °C, exploring a longer ratio around 1:2.25. Time window is your usual 28–32 s.');

-- 3. ALDI Lazzio Luxe Blend
INSERT INTO coffees (id, name, brand, product, origin_country, roast_level, field_sources, status, notes) VALUES
  (3, 'Lazzio Luxe Blend', 'Lazzio', 'Luxe Blend', 'Peru, Colombia', 'medium',
   '{"name":"historical","brand":"historical","product":"historical","origin_country":"historical","roast_level":"historical"}',
   'historical',
   'ALDI. 100% Arabica according to product information previously checked. Tasting notes not fully documented.');
INSERT INTO recipes (coffee_id, version, dose_g, yield_g, temperature_c, time_min_s, time_max_s, preinfusion_min_s, preinfusion_max_s, source, status, rationale) VALUES
  (3, 1, 20, 40, 93, 28, 32, 6, 8, 'historical', 'suggested',
   'Historical starting recipe for a medium roast.');

-- 4. Manna Colombia Regional Cumbia
INSERT INTO coffees (id, name, brand, product, origin_country, processing, variety, cupping_score, tasting_notes, field_sources, status, notes) VALUES
  (4, 'Manna Colombia Regional Cumbia', 'Manna Beans', 'Regional Cumbia', 'Colombia', 'Washed', 'Caturra / Castillo', 85.5,
   '["sweet","hazelnut","caramel","red apple","orange","molasses","rich","creamy","clean","bright acidity","medium-full body"]',
   '{"name":"historical","brand":"historical","product":"historical","origin_country":"historical","processing":"historical","variety":"historical","cupping_score":"packaging","tasting_notes":"packaging"}',
   'historical',
   'Roast date approximately two weeks before the June 2026 discussion (exact date unknown). Roast level not confirmed.');
INSERT INTO recipes (coffee_id, version, dose_g, yield_g, temperature_c, time_min_s, time_max_s, source, status, rationale) VALUES
  (4, 1, 20, 40, 93, 28, 32, 'historical', 'suggested',
   'Historical starting recipe. Suggested adjustments: sour or sharp → grind finer; bitter or dry → grind coarser; good but heavy → try 42 g; balanced acidity but lacking body → try 38 g.');

-- 5. 3 Beans
INSERT INTO coffees (id, name, roast_level, field_sources, status, notes) VALUES
  (5, '3 Beans', 'medium-dark',
   '{"name":"historical","roast_level":"visual"}',
   'historical',
   'Needs identification: origin, roaster, processing and variety unknown — do not infer origin or blend from the name. Described as fresh; exact roast date unknown. Roast level visually estimated as medium to medium-dark. Visual observations: some variation in bean colour; mostly dry appearance; a few beans with slight sheen.');
INSERT INTO recipes (coffee_id, version, dose_g, yield_g, temperature_c, time_min_s, time_max_s, source, status, rationale) VALUES
  (5, 1, 20, 40, 92, 27, 30, 'historical', 'suggested',
   'Historical starting recipe for a medium to medium-dark roast.');

-- 6. ALDI Lazzio Brazil Single Origin
INSERT INTO coffees (id, name, brand, product, origin_country, region, roast_level, intensity, tasting_notes, field_sources, status, notes) VALUES
  (6, 'Lazzio Brazil Single Origin', 'Lazzio', 'Brazil Single Origin', 'Brazil', 'Minas Gerais', 'medium', '4/5',
   '["toffee","bittersweet cocoa","milk chocolate"]',
   '{"name":"packaging","brand":"packaging","product":"packaging","origin_country":"packaging","region":"packaging","roast_level":"packaging","intensity":"packaging","tasting_notes":"packaging"}',
   'historical',
   'ALDI. Processing, variety and roast date unknown.');
INSERT INTO recipes (coffee_id, version, dose_g, yield_g, temperature_c, time_min_s, time_max_s, preinfusion_min_s, preinfusion_max_s, source, status, rationale) VALUES
  (6, 1, 20, 40, 93, 27, 30, 5, 8, 'historical', 'suggested',
   'Historical starting recipe. Expected profile from the packaging: chocolate, toffee and relatively full body — an expectation, not a tasting result.');

-- 7. ALDI Lazzio Luxe Reserve Guatemala
INSERT INTO coffees (id, name, brand, product, origin_country, roast_level, altitude, tasting_notes, field_sources, status, notes) VALUES
  (7, 'Lazzio Luxe Reserve Guatemala', 'Lazzio', 'Luxe Reserve', 'Guatemala', 'medium', 'High altitude (as described)',
   '["fruit","chocolate"]',
   '{"name":"packaging","brand":"packaging","product":"packaging","origin_country":"packaging","roast_level":"visual","altitude":"packaging","tasting_notes":"packaging"}',
   'historical',
   'ALDI. Packaging: “Delightful balance of fruit and chocolate notes that enhances its smooth profile.” Described as grown in rich volcanic soils. Processing, variety and roast date unknown. No confirmed tasting results yet. Visual observations: approximately medium roast; some colour variation; mostly dry; no obvious widespread oiliness.');
INSERT INTO recipes (coffee_id, version, dose_g, yield_g, temperature_c, time_min_s, time_max_s, preinfusion_min_s, preinfusion_max_s, source, status, rationale) VALUES
  (7, 1, 20, 40, 93, 28, 32, 5, 8, 'historical', 'suggested',
   'Historical starting recipe for a medium roast.');

-- Historical shot: coffee unknown, so it is not attributed (assign it in Settings if you know).
INSERT INTO shots (coffee_id, recipe_id, pulled_at, dose_g, yield_g, time_s, temperature_c, grinder_model, notes) VALUES
  (NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 19.7, 39.5, 24, 90, 'Smart Grinder Pro',
   'Historical shot from earlier notes; not necessarily the current baseline. Actual date and coffee unknown — the timestamp is the import date.');
