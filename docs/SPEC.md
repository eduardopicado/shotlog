# Shotlog — Specification (v0.2, for sign-off)

Personal coffee journal and espresso dial-in assistant.
Source: the handover document (objective, equipment, seven historical coffees, MVP criteria).
This spec turns that handover into concrete decisions. **Nothing gets built until this is signed off.**

Changes since v0.1: hosting decided (Cloudflare, free tier), AI models and spend controls decided,
all open questions resolved with the proposed defaults (§16). Cloudflare background: [CLOUDFLARE.md](CLOUDFLARE.md).

---

## 1. Scope

### 1.1 MVP goal (milestone 1)

> Add a coffee → get a recipe → log a shot → receive the next adjustment.

The MVP is done when all ten acceptance criteria in §15 pass on the deployed app.

### 1.2 In scope for the MVP

| Area | Included |
|---|---|
| Coffees | Create/edit/archive, packaging + bean photos, AI extraction with review, provenance per field |
| Bean analysis | AI visual observation stored separately from facts |
| Recipes | Deterministic starting recipe, optional AI refinement, versioned recipe history |
| Shots | Fast logging (prefilled form + quick text), tasting tags, score, notes, optional photo |
| Dial-in | Next-shot recommendation after every shot (engine; AI optional) |
| History | Per-coffee shot list, recipe timeline, best shot, current recipe, roast age |
| Dashboard | Active coffees, recent coffees, last shot, current recipe, quick actions |
| Data | Seed import of the 7 coffees, equipment, historical shot; JSON export |
| Hosting | Cloudflare Workers + D1 + R2, protected by Cloudflare Access, auto-deploy from GitHub |

### 1.3 Out of scope for the MVP (later phases)

Multi-user, native iOS app, inventory deduction per shot, charts/analytics, CSV export (JSON first),
shot video, offline-first sync (the app needs a connection).
Comparison between coffees is a **Phase 5** feature; a simple side-by-side table is a stretch goal.

---

## 2. User and equipment profile (seeded defaults)

| Item | Value |
|---|---|
| Machine | Breville Dual Boiler BES920BSS — temperature 86–96 °C, adjusted in 1 °C steps |
| Portafilter / basket | 58 mm, ~20 g basket |
| Grinder | Sage/Breville Smart Grinder Pro — dial 1–60, **lower = finer**; optional inner-burr position (1–10) |
| Tamper | 58.5 mm self-levelling |
| Accessories | WDT tool, puck screen |

**Brew preferences** (editable in Settings, used as engine defaults):

| Preference | Default |
|---|---|
| Dose | 20 g |
| Ratio | 1:2 (→ 40 g) |
| Target time | 28–32 s, **total time including pre-infusion** (what the BDB shot timer shows) |
| Pre-infusion | 5–8 s (seconds only; pre-infusion power is not recorded) |
| Temperature | chosen by roast level (§7) |

Rule: a grind number is only meaningful for this grinder and this bean. The app never presents a grind setting as universally correct.

---

## 3. Non-negotiable rules

These rules are enforced in code (schema constraints, validation, tests), not just in prompts.

| # | Rule | How it is enforced |
|---|---|---|
| R1 | **Ratio is always derived** from dose and yield, never typed in independently. Displayed as `1:X` (up to 2 decimals, trailing zeros dropped: `1:2`, `1:2.25`, `1:2.01`). | `ratio` is a generated DB column `yield_g / dose_g`. The UI may let you *enter* a ratio to compute the yield, but only yield is stored. |
| R2 | **Stated ratios are checked.** A printed recipe like "1:2.25, 20 g → 40 g" is flagged: *"20 g → 40 g is 1:2. A true 1:2.25 would be 45 g."* | `checkStatedRatio()` runs on every packaging recipe (AI-extracted or typed). Tolerance ±0.5 g on yield. |
| R3 | **Recipes ≠ shots.** A recipe is a plan; a shot is what actually happened. Editing or superseding a recipe never modifies any shot. | Separate tables. Shots are only edited through their own endpoint; recipes referenced by a shot are never edited in place (changes create a new version). |
| R4 | **Never invent facts.** Unknown stays unknown (empty). No origin, region, variety, processing or roast date is inferred from a name, a bean photo or a brand. | AI schemas allow `null`; prompts forbid inference; UI shows "Unknown". |
| R5 | **Provenance per field.** Every coffee fact records where it came from (§6). "Medium" (packaging) and "Estimated medium" (photo) look different everywhere. | `field_sources` map on the coffee. |
| R6 | **One major variable per adjustment** (grind, yield, temperature, dose, pre-infusion). | Engine produces exactly one change; AI suggestions that change more than one are rejected and the engine suggestion is used. |
| R7 | **Imported coffees are not "in stock".** | Seeded with status `historical`. Only you move them to `active`. |
| R8 | **Every AI-extracted field is editable** before and after saving. | Review screen is mandatory after extraction. |
| R9 | **The app works without AI.** Manual entry + deterministic engine cover the whole loop. | AI features disable themselves when no API key is set, the daily cap is hit, or the API refuses/fails. |
| R10 | **AI spend is capped** at three independent levels (§9.4). | Anthropic workspace spend limit + prepaid credits; in-app daily call cap; per-call token limits. |

---

## 4. Architecture

### 4.1 Shape

```
 iPhone / iPad (Safari, "Add to Home Screen")
        │ HTTPS  https://shotlog.<you>.workers.dev
        ▼
 ┌──────────── Cloudflare Access (login: one-time code to your email) ───────────┐
 │                                                                                │
 │  Cloudflare Worker "shotlog"                                                   │
 │   ├─ static assets: built React PWA (served directly, SPA fallback)            │
 │   └─ /api/*  → Hono app ── shared domain logic (engine, ratio, parser)         │
 │                  │            │                 │                              │
 │             D1 (SQLite)   R2 bucket (photos)   AI adapter ──► Claude API       │
 └────────────────────────────────────────────────────────────────────────────────┘
        ▲
   GitHub push to main ──► Workers Builds: apply D1 migrations, build, deploy
```

* **Shared domain code** (`src/shared/`): types, ratio maths, recipe engine, dial-in engine, quick-text parser. Pure TypeScript, used by both the Worker and the browser, unit-tested in isolation.
* **AI is an adapter** behind a small interface (`extractPackaging`, `analyzeBeans`, `refineRecipe`, `reviewAdvice`). Outputs are schema-validated and stored as structured data. Swapping provider = rewriting one file.
* **No server to maintain**: no OS, no HTTPS certificates, no process manager.

### 4.2 Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language, shared types between engine/API/UI |
| Runtime | Cloudflare Workers (free plan), `nodejs_compat` flag | Free, always on, HTTPS, no server |
| API framework | Hono | Small router built for Workers (Express does not run on Workers) |
| Database | Cloudflare D1 (SQLite) | Same SQL as the draft schema; migrations as `.sql` files |
| Photo storage | Cloudflare R2 | S3-style object storage; photos served back through the Worker (behind Access) |
| Frontend | React 19 + Vite + React Router, served as Worker static assets | Mobile-first SPA; hand-written CSS |
| Login | Cloudflare Access on the `workers.dev` URL, plus JWT check in the Worker | No auth code to write; Worker rejects requests that didn't pass Access |
| Deploy | Workers Builds (Cloudflare's GitHub integration) | Deploys on push — no local computer needed |
| Validation | Zod | Same schemas validate API input and AI output |
| Images | Resized **in the browser** to max 1600 px JPEG before upload (also converts iPhone HEIC) | Small uploads, low AI cost, fits Worker CPU limits |
| AI | Claude API, official `@anthropic-ai/sdk`, structured outputs | Vision + reliable structured JSON |
| Tests | Vitest (engine + API, the API running in Cloudflare's local Workers runtime), Playwright smoke test at phone size | |

Static-asset routing (checked against Wrangler's config schema):

```jsonc
// wrangler.jsonc (excerpt)
"assets": {
  "directory": "./dist",
  "binding": "ASSETS",
  "not_found_handling": "single-page-application",  // unknown paths → index.html
  "run_worker_first": ["/api/*"]                      // API requests go to the Worker code
}
```

### 4.3 Free-tier fit

Approximate free-plan limits, from memory — Cloudflare's docs site was not reachable from the build
session, so these are to be re-checked in M0 (links in CLOUDFLARE.md):

| Service | Free allowance (approx.) | Shotlog usage (estimate) |
|---|---|---|
| Workers | ~100,000 requests/day; ~10 ms CPU per request (waiting on D1/R2/Claude doesn't count) | < 500 requests/day |
| D1 | ~5 GB storage, ~5 M rows read/day, ~100 k rows written/day | A few MB after years |
| R2 | ~10 GB stored, ~1 M writes and ~10 M reads per month, no egress fees | ~0.3 MB per photo → thousands of photos |
| Access | Free for small teams (~50 users) | 1 user |
| Workers Builds | Free build minutes per month | A few minutes per deploy |

CPU-time watch point: converting a photo to base64 for the AI call. Use the native `Buffer` from `nodejs_compat` (fast) and keep images ≤ 1600 px. Fallback if it ever exceeds the limit: give Claude a short-lived signed R2 URL instead of the bytes.

### 4.4 Configuration

| Name | Kind | Purpose |
|---|---|---|
| `DB` | D1 binding | Database `shotlog` |
| `PHOTOS` | R2 binding | Bucket `shotlog-photos` |
| `ASSETS` | Assets binding | Built web app |
| `ANTHROPIC_API_KEY` | **Secret** (never in the repo or browser) | Enables AI features when set |
| `MODEL_VISION` | Variable | Default `claude-sonnet-5-5` (packaging, beans, recipe refinement) |
| `MODEL_TEXT` | Variable | Default `claude-haiku-5-5` (shot advice review) |
| `AI_DAILY_CALL_LIMIT` | Variable | Default `30` |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | Variables | Used to verify the Cloudflare Access login token |
| `AUTH_DISABLED` | Variable | `true` only in local development |

---

## 5. Data model

D1 (SQLite). Schema lives in `migrations/0001_init.sql` and later numbered migrations. All timestamps ISO-8601 UTC. Dates (`roast_date`, `purchase_date`) are `YYYY-MM-DD`. Weights in grams (1 decimal), times in seconds, temperature in °C.
Generated columns are used for `ratio`; M1 verifies they work on D1 (fallback: computed in the query layer, never stored separately).

### 5.1 `coffees`

| Field | Type | Notes |
|---|---|---|
| id | int PK | |
| name | text, required | Display name, e.g. "Lazzio Brazil Single Origin" |
| brand | text? | Brand or roaster |
| product | text? | Product line, e.g. "Luxe Reserve" |
| origin_country | text? | Free text; may be a blend ("Peru, Colombia") |
| region | text? | |
| farm | text? | Farm / producer / washing station |
| variety | text? | |
| processing | text? | Washed / Natural / Honey / … free text |
| roast_level | enum? | `light`, `light-medium`, `medium`, `medium-dark`, `dark` |
| roast_date | date? | Exact date only. Approximate info ("≈2 weeks before June 2026") goes in `notes` — never a guessed date |
| purchase_date | date? | |
| tasting_notes | text[] (JSON) | As printed on the bag (not your tasting results) |
| cupping_score | number? | |
| intensity | text? | Free text, e.g. "4/5" |
| altitude | text? | Free text, e.g. "≈2,000 m", "high altitude" |
| field_sources | JSON map field→source | See §6 |
| status | enum | `active`, `historical`, `finished`, `archived` |
| remaining_g | number? | Optional, manual |
| notes | text? | General notes, packaging descriptions, uncertainties |
| created_at / updated_at | timestamp | |

Status meanings: **active** = in use/in stock (shown on dashboard) · **historical** = imported, not confirmed in stock · **finished** = bag done · **archived** = hidden. History is kept in every status.

### 5.2 `coffee_images`

| Field | Type | Notes |
|---|---|---|
| id | int PK | |
| coffee_id | int? FK | Null while a new coffee is still being reviewed |
| r2_key | text | Object key in the `PHOTOS` bucket, e.g. `img/2026/11/<uuid>.jpg` |
| image_type | enum | `packaging`, `beans`, `shot`, `other` |
| ai_observations | JSON? | Packaging extraction or bean observation (§9) — raw structured AI output, kept for traceability |
| created_at | timestamp | |

### 5.3 Bean observations (visual analysis, separate from facts)

Stored in `coffee_images.ai_observations` for bean photos, shown in its own "Visual observations" panel:

| Field | Type |
|---|---|
| roast_estimate | roast level enum? |
| roast_estimate_note | text (e.g. "light-medium to medium") |
| colour_consistency | text |
| surface | text |
| oiliness | `dry`, `slight sheen`, `some oil`, `oily` |
| defects | text[] (quakers, broken beans, chips…) |
| general | text |
| confidence | `low` / `medium` / `high` |

The roast estimate only fills `coffees.roast_level` if that field is empty **and** you accept it; its source is then `visual` ("Estimated").

### 5.4 `equipment` and `settings`

| Field | Type |
|---|---|
| id | int PK |
| equipment_type | `machine`, `grinder`, `portafilter`, `tamper`, `accessory` |
| brand, model | text |
| configuration | JSON (e.g. `{"temp_min":86,"temp_max":96,"temp_step":1}`, `{"dial_min":1,"dial_max":60,"lower_is_finer":true,"inner_burr":true}`, `{"basket_g":20}`) |
| notes | text? |

`settings` (key → JSON): `brew_preferences` (§2).

### 5.5 `recipes` (plans — versioned)

| Field | Type | Notes |
|---|---|---|
| id | int PK | |
| coffee_id | FK | |
| version | int | 1, 2, 3… per coffee |
| dose_g, yield_g | number | |
| ratio | **generated** | `yield_g / dose_g` |
| temperature_c | number | |
| time_min_s, time_max_s | number | Target window, e.g. 28–32 |
| preinfusion_min_s, preinfusion_max_s | number? | e.g. 5–8 |
| grind_setting | number? | SGP dial number (1–60) |
| grind_inner | int? | SGP inner burr (1–10), optional |
| rationale | text | Short "why" shown under the recipe |
| source | enum | `engine`, `ai`, `packaging`, `historical`, `user`, `dial-in` |
| status | enum | `suggested`, `active`, `superseded` |
| promising | bool | Set when a shot on this recipe tasted good and the advice was "keep" |
| stated_ratio | number? | Packaging recipes only: ratio as printed, for the R2 check |
| based_on_shot_id | FK? | For `dial-in` recipes: the shot that produced this recommendation |
| created_at | timestamp | |

Lifecycle: a new suggestion is `suggested`. When you **use** it ("Use for next shot", or log a shot against it), it becomes `active` and the previous active recipe becomes `superseded`. At most one `active` recipe per coffee. A recipe referenced by a shot is never edited — changes create a new version.

**Current recipe** = the `active` recipe, else the newest `suggested` one.

### 5.6 `shots` (actual extractions)

| Field | Type | Notes |
|---|---|---|
| id | int PK | |
| coffee_id | FK? | Null only for historical shots whose coffee is unknown |
| recipe_id | FK? | Recipe the shot was aiming for |
| pulled_at | timestamp | Defaults to now; editable |
| dose_g, yield_g | number, required | |
| ratio | **generated** | |
| time_s | number, required | Total time including pre-infusion |
| temperature_c | number? | Prefilled from the recipe |
| preinfusion_s | number? | |
| grinder_model | text? | Prefilled from equipment |
| grind_setting | number? | SGP dial |
| grind_inner | int? | SGP inner burr |
| basket | text? | |
| taste_tags | tag[] (JSON) | §8.1 |
| score | int 1–5? | |
| feedback | text? | Free-form tasting description |
| notes | text? | Anything else (puck, prep, milk drink…) |
| photo_image_id | FK? | Optional shot photo (`coffee_images`, type `shot`) |
| advice | JSON | The recommendation generated after this shot (§8), so you can later see what was suggested and why |
| created_at | timestamp | |

Derived (not stored): roast age at time of shot = `pulled_at − roast_date` in days, when roast date is known.

### 5.7 `ai_usage` (cost tracking)

| Field | Type | Notes |
|---|---|---|
| id | int PK | |
| called_at | timestamp | |
| task | enum | `extract_packaging`, `analyze_beans`, `refine_recipe`, `review_advice` |
| model | text | Model that served the call |
| input_tokens, output_tokens | int | From the API response |
| est_cost_usd | number | Tokens × list price for that model |
| outcome | enum | `ok`, `invalid_output`, `refused`, `error`, `blocked_by_cap` |

Settings shows "AI this month: N calls, ≈ $X".

### 5.8 Derived views

| View | Definition |
|---|---|
| Best shot | Highest score; ties → most recent |
| Best recipe | Recipe of the best shot (or the best shot's actual numbers if it had no recipe) |
| Initial recipe | Version 1 of the coffee's recipes |
| Recipe changes over time | Recipe versions in order, each with the parameter that changed |

---

## 6. Provenance model

| Source | Meaning | UI label |
|---|---|---|
| `packaging` | Printed on the bag or product information | ✓ Packaging |
| `user` | Entered or confirmed by you | ✓ You |
| `visual` | Estimated from a bean photo | "Estimated …" (amber) |
| `historical` | Imported from earlier notes, not re-verified | "Imported" (grey) |

Empty value = **Unknown** (never a guess). Editing a field manually sets its source to `user`.

---

## 7. Starting recipe (deterministic engine)

Inputs: coffee facts, brew preferences, this coffee's shot history, your last shot on any coffee.

**Priority order**

1. If this coffee has a shot scored ≥ 4 → start from that shot's actual numbers (time window = its time ± 2 s).
2. Else use the roast-level profile below with your preferences.
3. Add short hints (text only, never parameter changes) from tasting notes / processing / roast age.
4. Grind: last setting used on *this* coffee if any; otherwise only a *hint* mentioning the setting from your last coffee (not filled in).

**Roast-level profile**

| Roast level | Temp | Ratio (20 g →) | Time | Pre-infusion |
|---|---|---|---|---|
| light | 94 °C | 1:2.2 (44 g) | 28–32 s | 5–8 s |
| light-medium | 94 °C | 1:2.1 (42 g) | 28–32 s | 5–8 s |
| medium | 93 °C | 1:2 (40 g) | 28–32 s | 5–8 s |
| medium-dark | 92 °C | 1:2 (40 g) | 27–30 s | 5–8 s |
| dark | 91 °C | 1:2 (40 g) | 26–30 s | 5–8 s |
| unknown | 93 °C | 1:2 (40 g) | 28–32 s | 5–8 s — rationale asks for a bean photo/bag info |

If the roast level is only a visual estimate, the rationale says so.

**Hints**

* Chocolate/caramel/nut notes → "1:2 keeps body; if heavy, +2 g yield."
* Fruit/citrus/floral/bright notes → "if sharp, try a longer ratio before going finer."
* Natural process → "not every natural needs a longer ratio — let taste decide."
* Roast age < 5 days → may gush/channel, consider resting. > 42 days → tends to run faster, expect to grind finer.

**AI refinement (optional, "Ask the barista"):** sends coffee facts + provenance, the engine recipe, shot history and equipment. The AI may adjust **within bounds** (temp 86–96 °C in 1 °C steps, ratio 1:1.5–1:3, dose 17–22 g, time window 20–40 s) and must return a rationale. Out-of-bounds output is rejected and the engine recipe stands.

---

## 8. Dial-in engine (next-shot recommendation)

### 8.1 Tasting input

Tap-chips (multi-select): **Sour**, **Bitter**, **Sweet**, **Dry/astringent**, **Thin/watery**, **Heavy/intense**, **Balanced**, **Too acidic (but good)**, **Spurting/channeling** (puck observation), plus flavour notes **Chocolate**, **Fruity**, **Nutty**, **Caramel/toffee** (recorded for history/comparisons; they don't drive adjustments).
Plus a score of 1–5 stars and free text.

### 8.2 Baseline

The next shot = the recipe the shot was aiming for, **with the grind you actually used**. If the shot had no recipe, the shot's own numbers. Exactly one variable is then changed (or none).
If the shot deviated from its recipe (dose ±0.3 g, yield ±1.5 g, temp ±1 °C), a note says so.

### 8.3 Decision table (first matching rule wins)

*fast* = time < target min, *slow* = time > target max, *very* = more than 6 s outside.

| # | Observation | Time | Recommendation | Variable |
|---|---|---|---|---|
| 1 | Channeling seen, **or** sour + bitter together | any | Keep recipe, fix puck prep (WDT to the bottom, level bed, flat puck screen, dry basket) | none |
| 2 | Sour | fast | Grind finer: 1 step (2 if very fast) | grind |
| 3 | Sour | slow | Probable channeling → puck prep; if still sour, 1 step coarser | none |
| 4 | Sour | in range | +1 °C (if < 96); at 96 °C → grind finer 1 step | temp |
| 5 | Dry/astringent | slow | Grind coarser 1 step | grind |
| 6 | Dry/astringent | fast / in range | Check puck prep; if still dry, 1 step coarser | none |
| 7 | Bitter | slow | Grind coarser 1 step (2 if very slow) | grind |
| 8 | Bitter | fast | Probable channeling → puck prep | none |
| 9 | Bitter | in range | −1 °C (if > 86), else 1 step coarser | temp |
| 10 | Thin/watery | fast | Grind finer 1 step (2 if very fast) | grind |
| 11 | Thin/watery | in range / slow | Yield −2 g (never below 1:1.5) | yield |
| 12 | Heavy/too intense | any | Yield +2 g | yield |
| 13 | Too acidic but good | any | +1 °C (if < 96), else yield +2 g | temp |
| 14 | Good (balanced/sweet or score ≥ 4, no faults) | any | **Keep** — mark recipe **promising**; time outside the window is mentioned but not "fixed" | none |
| 15 | No taste info | fast / slow | Grind toward the window (1–2 steps) | grind |
| 16 | No taste info | in range | Keep, ask for tasting notes next time | none |

Step sizes: grind 1 dial step (lower = finer; inner burr never changed automatically), temperature 1 °C, yield 2 g. Temperature clamped 86–96 °C, dial clamped 1–60.

Every recommendation contains a headline ("Grind finer: 14 → 13"), a 1–3 sentence explanation, optional checks, and the full parameter set for the next shot. "Use for next shot" turns it into a new recipe version (`source = dial-in`).

### 8.4 AI review (optional)

Triggered when you write free-text feedback, or tap "Ask the barista". The AI receives coffee facts, the current recipe, the last ≤ 10 shots with tags/scores/feedback, and the engine's recommendation, and returns the same structure as §8.3. Validation:

* changes at most one major variable versus the baseline (R6) and stays in bounds;
* otherwise the engine recommendation is used and the AI text is discarded.

Stored advice records `source: engine | ai` and, when AI differs, the engine's original call.

---

## 9. AI layer

### 9.1 General

* Provider: Anthropic Claude API via the official SDK, structured outputs (JSON schema from Zod) for every call — no prose-only results.
* Models (configurable, §4.4):
  * **Claude Sonnet 5.5** (`claude-sonnet-5-5`) — packaging photos, bean photos, recipe refinement (accuracy matters; ~once per bag). Server-side refusal fallback enabled (`fallbacks: "default"`).
  * **Claude Haiku 5.5** (`claude-haiku-5-5`) — shot advice review (frequent, short).
* The model never writes to the database directly; the Worker validates and you confirm.
* Failure (no key, cap reached, network error, refusal, invalid output) → clear message, manual path still works, outcome logged in `ai_usage`.

### 9.2 Calls

| Call | Model | Input | Output (schema) | Hard rules in the prompt |
|---|---|---|---|---|
| `extractPackaging` | Sonnet | 1–4 packaging photos (+ optional typed text) | Per coffee field: `value` or `null` + `evidence` (text read). `tasting_notes[]`, `packaging_recipe {dose, yield, stated_ratio, time, temperature}` or null, `raw_text`, `uncertainties[]` | Only what is legible. Unknown → null. No inference from brand/name. Roast level only if printed. |
| `analyzeBeans` | Sonnet | 1 bean photo | Bean observation (§5.3) | Appearance only. Never origin, variety, processing. Roast level is an *estimate* with confidence. |
| `refineRecipe` | Sonnet | Coffee + provenance, engine recipe, history, equipment | Recipe params + rationale | Bounds in §7; brief rationale; no generic coffee lectures. |
| `reviewAdvice` | Haiku | Coffee, recipe, recent shots, engine advice, free text | Advice (§8.3) | One variable; grind for extraction, yield for strength, temp in 1 °C steps; consider channeling before "grind finer". |

Extraction results go to a **review screen** with every field editable, source preset to "Packaging". A packaging recipe goes through the R2 check and shows the warning if inconsistent.

### 9.3 Cost estimate

Assumptions: 3 bags/month (2 packaging photos + 1 bean photo + 1 recipe refinement each) and 60 shots/month with an AI review on every shot (worst case; in practice only shots with free text). List prices: Sonnet 5.5 $2 / $10, Haiku 5.5 $0.10 / $0.50 per million input / output tokens.

| | Tokens (approx.) | Cost |
|---|---|---|
| Per bag (Sonnet) | ~15 k in, ~5.5 k out | ~$0.08 |
| Per shot review (Haiku) | ~4 k in, ~1.5 k out | ~$0.001 |
| **Month (3 bags + 60 shots)** | | **≈ $0.30** |

### 9.4 Spend controls (R10)

Three independent layers, so a bug, a leaked key or a loop can't run up a bill:

| Layer | Control | Setting |
|---|---|---|
| Anthropic account | **Prepaid credits with auto-reload off** — the API stops when the balance is used up | Buy the minimum top-up |
| Anthropic account | **Dedicated workspace "shotlog" with its own monthly spend limit**; the app's API key belongs only to that workspace | e.g. $5/month |
| Key handling | Key stored only as a Cloudflare **secret**; never in the repo, the browser or logs; only requests that passed Cloudflare Access reach the AI endpoints | Rotate if ever exposed |
| App | **Daily call cap** (`AI_DAILY_CALL_LIMIT`, counted in `ai_usage`); calls over the cap are refused with a message | 30/day |
| App | **Per-call limits**: `max_tokens` per task, ≤ 4 images per call, images ≤ 1600 px, history trimmed to the last 10 shots | |
| App | **Visibility**: month-to-date calls and estimated cost in Settings | |

When the Anthropic spend limit is reached, the API returns an error (`enforced_spend_limit_reached`); the app shows "AI unavailable — spend limit reached" and carries on without AI.

---

## 10. Quick shot entry (text)

Optional single text box on the shot screen, parsed **deterministically** (no AI needed), filling the form fields:

`"20 g in, 40 g out, 24 seconds, 93°C. Tastes a little sour."` → dose 20, yield 40, time 24, temp 93, tags [sour]
`"20 in 42 out 29s grind 12 pi 6s — much sweeter, good chocolate"` → … grind 12, PI 6, tags [sweet, chocolate]

Negations ("not bitter", "no sourness") are not tagged. Parsed values appear in the form before saving.

---

## 11. REST API

JSON over `/api` (Hono). Bodies validated with Zod; errors return `{ error, details? }` with 4xx. Every `/api` request must carry a valid Cloudflare Access token (except when `AUTH_DISABLED=true` locally).

| Method & path | Purpose |
|---|---|
| `GET /api/dashboard` | Active coffees with current recipe + last shot, recent coffees, last shot overall |
| `GET /api/coffees?status=` | List with summary (shot count, avg/best score, roast age) |
| `POST /api/coffees` | Create (body includes `field_sources`, optional `image_ids` to attach) |
| `GET /api/coffees/:id` | Coffee + images + recipes + shots + best shot + current recipe |
| `PATCH /api/coffees/:id` | Edit fields / status |
| `POST /api/images` (multipart) | Upload a photo to R2 (`image_type`, optional `coffee_id`) |
| `GET /api/images/:id/file` | Stream a photo from R2 |
| `POST /api/ai/extract-packaging` | `{ image_ids[], text? }` → extraction draft (not saved as a coffee) |
| `POST /api/ai/analyze-beans` | `{ image_id }` → observation (saved on the image) |
| `POST /api/coffees/:id/recipes/suggest` | `{ use_ai? }` → new `suggested` recipe |
| `POST /api/coffees/:id/recipes` | Manual recipe (incl. packaging recipe with `stated_ratio`) |
| `POST /api/recipes/:id/activate` | Make active, supersede previous |
| `POST /api/shots` | Log shot → returns saved shot + advice |
| `PATCH /api/shots/:id` | Edit a shot's own fields (recipes untouched) |
| `POST /api/shots/:id/advice` | `{ use_ai? }` → recompute advice |
| `POST /api/shots/:id/apply-advice` | Create the next recipe version from the stored advice and activate it |
| `GET /api/compare?ids=1,2` | Side-by-side data (stretch) |
| `GET/PUT /api/equipment`, `GET/PUT /api/settings` | Equipment and brew preferences |
| `GET /api/export` | Full JSON export (all tables + photo keys) |
| `GET /api/status` | Version, AI configured?, AI calls today / cap, month-to-date AI cost |

---

## 12. User interface

Mobile-first (designed at 390 px wide, works on iPad/desktop). Bottom navigation: **Home · Coffees · + Shot · Settings**. Large tap targets, number steppers, light/dark theme from the system. Installable to the home screen (manifest + small service worker caching the app shell).

### 12.1 Screens

| Screen | Contents |
|---|---|
| **Home** | Active coffee cards (name, roast age, current recipe `20 g → 40 g · 1:2 · 93 °C · 28–32 s`, last shot + score) with **Log shot**; "Add coffee"; last shot overall with its advice; recently used coffees; link to historical/imported coffees |
| **Coffees** | Filter chips by status; list with shot count and best score |
| **Add coffee** | ① Take/upload packaging photo(s) and optional bean photo → ② "Read packaging" (AI) or "Enter manually" → ③ Review form with provenance labels, ratio warning for a printed recipe, visual observations panel → ④ Save → offers starting recipe |
| **Coffee detail** | Facts with provenance badges and "Unknown" for empty fields; visual observations; photos; **Current recipe** card (+ rationale, "Use / Ask the barista / Edit"); **Best shot**; shot history (newest first: date, numbers, ratio, time, tags, score, roast age); recipe timeline (version, what changed, source, status); status actions (Mark active / finished / archive) |
| **Log shot** | Prefilled from the current recipe (dose, yield, temp, PI, grind). Steppers, live ratio, time field, tasting chips, score stars, optional text + quick-text parser. Save in < 30 s |
| **Advice** (after saving) | Headline, explanation, checks, next-shot parameters with the changed one highlighted; **Use for next shot** / **Keep current recipe** |
| **Settings** | Equipment, brew preferences, AI status (calls today / cap, month cost), export, "Unassigned historical shots" (assign to a coffee) |

### 12.2 The 30-second shot flow

Home → **Log shot** on the coffee card → numbers already filled → adjust time (and yield if different) → tap 1–3 taste chips → tap score → **Save** → advice shown → **Use for next shot**.

---

## 13. Seed data

Applied by a D1 migration (`migrations/0002_seed.sql`), so it runs exactly once per database. All seven coffees get status **historical**; field sources are **historical** unless stated below. Historical recipes are `source = historical`, `status = suggested` — **suggestions, not confirmed results**.

| # | Coffee | Facts (source) | Recipes |
|---|---|---|---|
| 1 | Ethiopia Karamo Single Origin | Ethiopia; Arabica, Heirloom (variety); ≈2,000 m; Natural (packaging); roast date 2026-05-26; roast level light-medium (visual — note "light-medium to medium") | v1 **packaging**: 20 → 40 g, 28 s, `stated_ratio` 2.25 → flagged (is 1:2; 1:2.25 = 45 g). v2 historical: 20 → 45 g (explore 44–46 g), 94 °C, 28–32 s |
| 2 | Roosevelt Ethiopian Natural | Roosevelt; Ethiopia; Natural; variety/roast date/roast level unknown | v1: 20 → 45 g (1:2.25), 94 °C (note "94–95 °C"), 28–32 s |
| 3 | Lazzio Luxe Blend (ALDI) | Lazzio; Peru, Colombia; 100% Arabica (in notes); medium | v1: 20 → 40 g, 93 °C, 28–32 s, PI 6–8 s |
| 4 | Manna Colombia Regional Cumbia | Manna Beans; Colombia; Washed; Caturra / Castillo; cupping 85.5; tasting notes (packaging): sweet, hazelnut, caramel, red apple, orange, molasses, rich, creamy, clean, bright acidity, medium-full body; roast date unknown (notes: "≈2 weeks before the June 2026 discussion"); roast level unknown | v1: 20 → 40 g, 93 °C, 28–32 s; rationale includes the suggested adjustments (sour→finer, bitter→coarser, heavy→42 g, lacking body→38 g) |
| 5 | 3 Beans | Name only; everything else unknown; roast level medium-dark (visual — "medium to medium-dark"); notes "described as fresh"; visual observations: some colour variation, mostly dry, a few beans with slight sheen | v1: 20 → 40 g, 92 °C, 27–30 s |
| 6 | Lazzio Brazil Single Origin (ALDI) | Lazzio; Brazil; Minas Gerais; medium (packaging); intensity 4/5; tasting notes toffee, bittersweet cocoa, milk chocolate (packaging) | v1: 20 → 40 g, 93 °C, 27–30 s, PI 5–8 s; rationale "expected chocolate/toffee, full body — expectation, not a result" |
| 7 | Lazzio Luxe Reserve Guatemala (ALDI) | Lazzio; Luxe Reserve; Guatemala; "high altitude"; "rich volcanic soils" + packaging description (notes); tasting notes fruit, chocolate; medium (visual); visual observations: medium, some colour variation, mostly dry, no widespread oil | v1: 20 → 40 g, 93 °C, 28–32 s, PI 5–8 s |

Where the handover says a value came from packaging/product info (Karamo processing, Brazil roast level/region/notes, Manna details, Guatemala notes), the source is `packaging`; otherwise `historical`. Visual estimates are `visual`.

**Equipment:** BDB BES920BSS, SGP, 58 mm portafilter (~20 g basket), 58.5 mm self-levelling tamper, WDT tool, puck screen.

**Historical shot:** 19.7 g → 39.5 g (1:2.01), 24 s, 90 °C, **coffee unknown** (`coffee_id = null`), note "Historical shot from earlier notes; not necessarily the current baseline." Listed under Settings → Unassigned shots, where you can assign it.

---

## 14. Build plan

| Milestone | Delivers | Who |
|---|---|---|
| M0 | This spec approved; free-tier figures re-checked | You + me |
| M1 Core | Worker project (Wrangler config, Hono), D1 migrations + seed, shared engine + parser, REST API — all tested locally in Cloudflare's runtime | Me |
| M2 UI loop | Home, coffees, add/edit coffee (manual), recipe card, log shot, advice, history, settings, export, Access token check — **MVP usable without AI** | Me |
| M3 First deploy | Cloudflare account, D1 database, R2 bucket, Access on the workers.dev URL, Workers Builds connected to GitHub — step-by-step in CLOUDFLARE.md, done from a browser | You (guided) |
| M4 AI | Packaging extraction + review, bean analysis, recipe refinement, advice review, `ai_usage` + caps; Anthropic workspace + spend limit + secret | Me, you add the key |
| M5 Polish | PWA icon/manifest, Playwright phone test, README, comparison table (stretch) | Me |

Each milestone is committed separately so you can try it before the next one.

---

## 15. Acceptance criteria → tests

| # | Criterion (handover §8) | Verified by |
|---|---|---|
| 1 | Add a coffee using a packaging photo | API test with mocked AI; manual test with a real photo on the deployed app |
| 2 | Review and correct AI-extracted info | UI: review form editable; source changes to `user` on edit |
| 3 | Upload beans photo, save visual observations | API test (mocked AI, local R2); observation panel |
| 4 | Recipe tailored to the BDB | Engine unit tests (roast table, temp bounds 86–96) |
| 5 | Log a shot in a few seconds | Playwright: prefilled form, ≤ 6 taps to save |
| 6 | Record sour/bitter/sweet/balanced… | Taste chips stored as tags |
| 7 | Concrete next-shot recommendation | Engine tests for every row of §8.3, incl. the handover examples (24 s sour → finer; 29 s sweet + chocolate → keep, promising) |
| 8 | Complete history of a coffee | Coffee detail: shots, recipe timeline, roast age |
| 9 | Identify the best recipe so far | Best-shot rule test |
| 10 | Close/reopen without losing data | Data lives in D1/R2; API test re-reads after a fresh Worker start; manual check on the phone |
| R1/R2 | Ratio never inconsistent; Karamo flagged | Unit tests: `1:2`, `1:2.25`, `1:2.01`; Karamo warning text |
| R3 | Recipe change never alters shots | API test: supersede recipe, shots unchanged |
| R10 | Spend caps work | API test: call over the daily cap is refused and logged |

---

## 16. Decisions (resolved)

| # | Question | Decision |
|---|---|---|
| 1 | Hosting | Cloudflare Workers + D1 + R2, Cloudflare Access login, Workers Builds deploys from GitHub. $0/month |
| 2 | Sour shot within the target time | +1 °C (flow is already right); grind finer only if already at 96 °C |
| 3 | Score scale | 1–5 stars |
| 4 | SGP grind setting | Dial number (1–60) + optional inner burr (1–10) |
| 5 | Shot time | Total time including pre-infusion |
| 6 | Temperature | 86–96 °C in 1 °C steps; pre-infusion power not recorded |
| 7 | AI | Claude API: Sonnet 5.5 for photos/recipes, Haiku 5.5 for shot advice; ≈ $0.30/month; capped per §9.4 |
