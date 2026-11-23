# Shotlog — Specification (v0.1, draft for review)

Personal coffee journal and espresso dial-in assistant.
Source: the handover document (objective, equipment, seven historical coffees, MVP criteria).
This spec turns that handover into concrete decisions. **Nothing gets built until this is signed off.**
Open decisions are collected in [§16](#16-open-questions-need-your-answer) and marked **[OPEN-n]** in the text.

---

## 1. Scope

### 1.1 MVP goal (milestone 1)

> Add a coffee → get a recipe → log a shot → receive the next adjustment.

The MVP is done when all ten acceptance criteria in §15 pass.

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

### 1.3 Out of scope for the MVP (later phases)

Multi-user/auth, cloud image storage, native iOS app, inventory deduction per shot, charts/analytics,
CSV export (JSON first), shot video, offline-first sync (the app needs the server to be reachable).
Comparison between coffees is a **Phase 5** feature but a simple side-by-side table is cheap and included as a stretch goal.

---

## 2. User and equipment profile (seeded defaults)

| Item | Value |
|---|---|
| Machine | Breville Dual Boiler BES920BSS — temperature range 86–96 °C, set in 1 °C steps **[OPEN-6]** |
| Portafilter / basket | 58 mm, ~20 g basket |
| Grinder | Sage/Breville Smart Grinder Pro — grind steps 1–60 on the dial, **lower = finer**; optional inner-burr position **[OPEN-4]** |
| Tamper | 58.5 mm self-levelling |
| Accessories | WDT tool, puck screen |

**Brew preferences** (editable in Settings, used as engine defaults):

| Preference | Default |
|---|---|
| Dose | 20 g |
| Ratio | 1:2 (→ 40 g) |
| Target time | 28–32 s |
| Pre-infusion | 5–8 s |
| Temperature | chosen by roast level (§7) |

Rule: a grind number is only meaningful for this grinder and this bean. The app never presents a grind setting as universally correct.

---

## 3. Non-negotiable rules

These rules are enforced in code (schema constraints, validation, tests), not just in prompts.

| # | Rule | How it is enforced |
|---|---|---|
| R1 | **Ratio is always derived** from dose and yield, never typed in independently. Displayed as `1:X` (up to 2 decimals, trailing zeros dropped: `1:2`, `1:2.25`, `1:2.01`). | `ratio` is a generated DB column `yield_g / dose_g`. The UI may let you *enter* a ratio to compute the yield, but only yield is stored. |
| R2 | **Stated ratios are checked.** A printed recipe like "1:2.25, 20 g → 40 g" is flagged: *"20 g → 40 g is 1:2. A true 1:2.25 would be 45 g."* | `checkStatedRatio()` runs on every packaging recipe (AI-extracted or typed). Tolerance ±0.5 g on yield. |
| R3 | **Recipes ≠ shots.** A recipe is a plan; a shot is what actually happened. Editing or superseding a recipe never modifies any shot. | Separate tables. Shots are append-only except for their own tasting fields/notes; recipes are versioned, never edited in place once a shot references them. |
| R4 | **Never invent facts.** Unknown stays unknown (empty). No origin, region, variety, processing or roast date is inferred from a name, a bean photo or a brand. | AI schemas allow `null`; prompts forbid inference; UI shows "Unknown". |
| R5 | **Provenance per field.** Every coffee fact records where it came from (§6). "Medium" (packaging) and "Estimated medium" (photo) look different everywhere. | `field_sources` map on the coffee. |
| R6 | **One major variable per adjustment** (grind, yield, temperature, dose, pre-infusion). | Engine produces exactly one change; AI suggestions that change more than one variable are rejected and the engine suggestion is used. |
| R7 | **Imported coffees are not "in stock".** | Seeded with status `historical`. Only you move them to `active`. |
| R8 | **Every AI-extracted field is editable** before and after saving. | Review screen is mandatory after extraction. |
| R9 | **The app works without AI.** Manual entry + deterministic engine cover the whole loop. | AI features hide/disable themselves when no API key is configured. |

---

## 4. Architecture

### 4.1 Shape

```
 iPhone / iPad (Safari, "Add to Home Screen")
        │  HTTPS (or LAN HTTP)
        ▼
 ┌──────────────────────── Node.js server ────────────────────────┐
 │  Express REST API  ──  domain logic (shared/)  ──  SQLite file │
 │        │                    ▲                                   │
 │        └── AI adapter ──────┘  (optional; Claude API)           │
 │  Static web app (built React PWA)     data/uploads/*.jpg        │
 └─────────────────────────────────────────────────────────────────┘
```

* **One process, one SQLite file, one uploads folder.** Backup = copy the `data/` folder.
* **Shared domain code** (`src/shared/`): types, ratio maths, recipe engine, dial-in engine, quick-text parser. Used by both server and browser, unit-tested in isolation.
* **AI is an adapter** behind a small interface (`extractPackaging`, `analyzeBeans`, `refineRecipe`, `reviewAdvice`). Its outputs are validated with schemas and stored as structured data. Swapping providers means rewriting one file.

### 4.2 Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language, shared types between engine/server/UI |
| Server | Node 22 + Express 5 | Small, well known |
| DB | SQLite via `better-sqlite3` | Single file, zero ops, synchronous & fast, fine for one user |
| Validation | Zod | Same schemas validate API input and AI output |
| Frontend | React 19 + Vite + React Router | Mobile-first SPA; hand-written CSS (no UI framework) |
| PWA | Web manifest + small service worker (caches the app shell only) | Home-screen icon, full-screen launch |
| Images | Resized **in the browser** to max 1600 px JPEG before upload (also converts iPhone HEIC) | Small uploads, within AI image limits |
| AI | Anthropic Claude API, official `@anthropic-ai/sdk`, structured outputs (JSON schema) | Vision + reliable structured JSON |
| Tests | Vitest (unit + API with Supertest), Playwright smoke test at phone size | |

### 4.3 Hosting **[OPEN-1]**

The phone needs to reach the server. Options:

| Option | Pros | Cons |
|---|---|---|
| A. Mac/PC at home, open on the LAN | Free, data stays home | Only works at home; computer must be on; no HTTPS → no service worker (app still works, just no offline shell) |
| B. Small always-on box (Raspberry Pi/NAS) + Tailscale | Works anywhere via Tailscale, HTTPS via Tailscale certs | Some setup |
| C. Small cloud host (e.g. Fly.io / Render with a persistent volume) | Works anywhere, HTTPS | Needs auth (a single password/token), a few $/month, photos in the cloud |

Recommendation: build for **A/B** first (no auth), keep a single-password option ready for C.

### 4.4 Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `SHOTLOG_DATA_DIR` | `./data` | DB + uploads |
| `ANTHROPIC_API_KEY` | — | Enables AI features when set |
| `SHOTLOG_MODEL` | `claude-opus-5-5` | Model used for all AI calls |
| `SHOTLOG_PASSWORD` | — | Optional single-user password (hosting option C) |

---

## 5. Data model

All timestamps ISO-8601 UTC. Dates (`roast_date`, `purchase_date`) are `YYYY-MM-DD`. Weights in grams (1 decimal), times in seconds, temperature in °C.

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
| tasting_notes | text[] | As printed on the bag (not your tasting results) |
| cupping_score | number? | |
| intensity | text? | Free text, e.g. "4/5" |
| altitude | text? | Free text, e.g. "≈2,000 m", "high altitude" |
| field_sources | map field→source | See §6 |
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
| file_name | text | Stored under `data/uploads/` |
| image_type | enum | `packaging`, `beans`, `shot`, `other` |
| ai_observations | json? | Packaging extraction result or bean observation (§9) — the raw structured AI output, kept for traceability |
| created_at | timestamp | |

### 5.3 `bean_observations` (visual analysis, separate from facts)

Stored inside `coffee_images.ai_observations` for bean photos, shown in its own "Visual observations" panel:

| Field | Type |
|---|---|
| roast_estimate | enum roast level? |
| roast_estimate_note | text (e.g. "light-medium to medium") |
| colour_consistency | text |
| surface / oiliness | text / enum `dry`, `slight sheen`, `some oil`, `oily` |
| defects | text[] (quakers, broken beans, chips…) |
| general | text |
| confidence | `low` / `medium` / `high` |

The bean roast estimate only fills `coffees.roast_level` if that field is empty **and** you accept it; its source is then `visual` ("Estimated").

### 5.4 `equipment`

| Field | Type |
|---|---|
| id | int PK |
| equipment_type | `machine`, `grinder`, `portafilter`, `tamper`, `accessory` |
| brand, model | text |
| configuration | json (e.g. `{ "temp_min": 86, "temp_max": 96, "basket_g": 20 }`, `{ "lower_is_finer": true, "steps": 60 }`) |
| notes | text? |

Plus a `settings` row holding the brew preferences in §2.

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
| grind_setting | number? | **[OPEN-4]** |
| rationale | text | Short "why" shown under the recipe |
| source | enum | `engine`, `ai`, `packaging`, `historical`, `user`, `dial-in` |
| status | enum | `suggested`, `active`, `superseded` |
| promising | bool | Set when a shot on this recipe tasted good and the advice was "keep" |
| stated_ratio | number? | Packaging recipes only: the ratio as printed, for the R2 check |
| based_on_shot_id | FK? | For `dial-in` recipes: the shot that produced this recommendation |
| created_at | timestamp | |

Lifecycle: a new suggestion is `suggested`. When you **use** it (tap "Use for next shot" or log a shot against it), it becomes `active` and the previously active recipe becomes `superseded`. At most one `active` recipe per coffee. A recipe referenced by a shot is never edited — changes create a new version.

**Current recipe** of a coffee = the `active` recipe, else the newest `suggested` one.

### 5.6 `shots` (actual extractions — append-only)

| Field | Type | Notes |
|---|---|---|
| id | int PK | |
| coffee_id | FK? | Null only for historical shots whose coffee is unknown |
| recipe_id | FK? | Recipe the shot was aiming for |
| pulled_at | timestamp | Defaults to now; editable |
| dose_g, yield_g | number, required | |
| ratio | **generated** | |
| time_s | number, required | Total shot time including pre-infusion **[OPEN-5]** |
| temperature_c | number? | Prefilled from the recipe |
| preinfusion_s | number? | |
| grinder_model | text? | Prefilled from equipment |
| grind_setting | number? | |
| basket | text? | |
| taste_tags | tag[] | §8.1 |
| score | 1–5? | **[OPEN-3]** |
| feedback | text? | Free-form tasting description |
| notes | text? | Anything else (puck, prep, milk drink…) |
| photo_file | text? | Optional |
| advice | json | The recommendation generated after this shot (§8), stored so you can see later what was suggested and why |
| created_at | timestamp | |

Derived (not stored): roast age at time of shot = `pulled_at − roast_date` in days, when roast date is known.

### 5.7 Derived views

| View | Definition |
|---|---|
| Best shot | Highest score; ties → most recent |
| Best recipe | Recipe of the best shot (or the best shot's actual numbers if it had no recipe) |
| Initial recipe | Version 1 of the coffee's recipes |
| Recipe changes over time | Recipe versions in order, each with the parameter that changed |

---

## 6. Provenance model

Each fact on a coffee has one source:

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
3. Add short hints (not rule changes) from tasting notes / processing / roast age.
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

**Hints (text only, never automatic parameter changes)**

* Chocolate/caramel/nut notes → "1:2 keeps body; if heavy, +2 g yield."
* Fruit/citrus/floral/bright notes → "if sharp, try a longer ratio before going finer."
* Natural process → "not every natural needs a longer ratio — let taste decide."
* Roast age < 5 days → may gush/channel, consider resting. > 42 days → tends to run faster, expect to grind finer.

**AI refinement (optional):** "Ask the barista" sends the coffee facts, the engine recipe and the shot history to the AI, which may adjust **within bounds** (temp 86–96 °C, ratio 1:1.5–1:3, dose 17–22 g, time window 20–40 s) and must return a rationale. Out-of-bounds output is rejected.

---

## 8. Dial-in engine (next-shot recommendation)

### 8.1 Tasting input

Tap-chips (multi-select): **Sour**, **Bitter**, **Sweet**, **Dry/astringent**, **Thin/watery**, **Heavy/intense**, **Balanced**, **Too acidic (but good)**, **Spurting/channeling** (puck observation), plus flavour notes **Chocolate**, **Fruity**, **Nutty**, **Caramel/toffee** (recorded, used for comparisons, don't drive adjustments).
Plus score 1–5 and free text.

### 8.2 Baseline

The next shot = the recipe the shot was aiming for, **with the grind you actually used**. If the shot had no recipe, the shot's own numbers. Exactly one variable is then changed (or none).
If the shot deviated from its recipe (dose ±0.3 g, yield ±1.5 g, temp ±1 °C), a note says so.

### 8.3 Decision table (first matching rule wins)

Let *fast* = time < target min, *slow* = time > target max, *very* = more than 6 s outside.

| # | Observation | Time | Recommendation | Variable |
|---|---|---|---|---|
| 1 | Channeling seen, **or** sour + bitter together | any | Keep recipe, fix puck prep (WDT to the bottom, level bed, flat puck screen, dry basket) | none |
| 2 | Sour | fast | Grind finer: 1 step (2 if very fast) | grind |
| 3 | Sour | slow | Probable channeling → puck prep; if still sour, 1 step coarser | none |
| 4 | Sour | in range | **[OPEN-2]** Proposed: +1 °C (if < 96). Alternative: grind finer 1 step | temp |
| 5 | Dry/astringent | slow | Grind coarser 1 step | grind |
| 6 | Dry/astringent | fast / in range | Check puck prep; if still dry, 1 step coarser | none |
| 7 | Bitter | slow | Grind coarser 1 step (2 if very slow) | grind |
| 8 | Bitter | fast | Probable channeling → puck prep | none |
| 9 | Bitter | in range | −1 °C (if > 86), else 1 step coarser | temp |
| 10 | Thin/watery | fast | Grind finer 1 step (2 if very fast) | grind |
| 11 | Thin/watery | in range / slow | Yield −2 g (never below 1:1.5) | yield |
| 12 | Heavy/too intense | any | Yield +2 g | yield |
| 13 | Too acidic but good | any | +1 °C (if < 96), else yield +2 g | temp |
| 14 | Good (balanced/sweet or score ≥ 4, no faults) | any | **Keep** — mark recipe **promising**; time outside window is mentioned but not "fixed" | none |
| 15 | No taste info | fast / slow | Grind toward the window (1–2 steps) | grind |
| 16 | No taste info | in range | Keep, ask for tasting notes next time | none |

Step sizes: grind 1 step (SGP numbers, lower = finer), temperature 1 °C, yield 2 g. Temperature clamped 86–96 °C.

Every recommendation contains: headline ("Grind finer: 14 → 13"), a 1–3 sentence explanation, optional checks, and the full parameter set for the next shot. "Use for next shot" turns it into a new recipe version (`source = dial-in`).

### 8.4 AI review (optional)

When AI is enabled and you wrote free-text feedback (or tap "Ask the barista"), the AI receives: coffee facts, the current recipe, the last ≤ 10 shots with tags/scores/feedback, and the engine's recommendation. It returns the same structure as §8.3. Validation:

* changes at most one major variable versus the baseline (R6) and stays in bounds,
* otherwise the engine recommendation is used and the AI text is discarded.

The stored advice records `source: engine | ai` and, when AI differs, the engine's original call.

---

## 9. AI layer

### 9.1 General

* Provider: Anthropic Claude API, model `claude-opus-5-5` (configurable). Structured outputs (JSON schema from Zod) for every call — no free-prose-only results.
* The model never writes to the database directly; the server validates and you confirm.
* Failure modes (no key, network error, refusal, invalid output) → clear message, manual path still works.
* Rough cost: a few US cents per photo extraction or advice call. **[OPEN-7]**

### 9.2 Calls

| Call | Input | Output (schema) | Hard rules in the prompt |
|---|---|---|---|
| `extractPackaging` | 1–4 packaging photos (+ optional text you typed) | For each coffee field: `value` or `null`, plus `evidence` (the text read). Also `tasting_notes[]`, `packaging_recipe {dose, yield, stated_ratio, time, temperature}` or null, `raw_text`, `uncertainties[]` | Only what is legible on the packaging. Unknown → null. No inference from brand/name. Roast level only if printed. |
| `analyzeBeans` | 1 bean photo | `bean_observations` (§5.3) | Describe appearance only. Never claim origin, variety, processing. Roast level is an *estimate* with confidence. |
| `refineRecipe` | Coffee facts + provenance, engine recipe, shot history, equipment | Recipe params + rationale | Bounds in §7; one coherent recipe; brief rationale; no generic coffee lectures. |
| `reviewAdvice` | Coffee, recipe, recent shots, engine advice, free text | Advice (§8.3) | One variable; prioritise grind for extraction, yield for strength, temp in 1 °C steps; consider channeling before "grind finer". |

Extraction results are shown on a **review screen** with every field editable and the source label "Packaging" pre-set; a packaging recipe runs through the R2 ratio check and shows the warning if inconsistent.

---

## 10. Quick shot entry (text)

Optional single text box on the shot screen, parsed **deterministically** (no AI needed), filling the form fields:

`"20 g in, 40 g out, 24 seconds, 93°C. Tastes a little sour."` → dose 20, yield 40, time 24, temp 93, tags [sour]
`"20 in 42 out 29s grind 12 pi 6s — much sweeter, good chocolate"` → … grind 12, PI 6, tags [sweet, chocolate]

Negations ("not bitter", "no sourness") are ignored as tags. Parsed values are shown in the form before saving.

---

## 11. REST API

JSON over `/api`. All bodies validated with Zod; errors return `{ error, details? }` with 4xx.

| Method & path | Purpose |
|---|---|
| `GET /api/dashboard` | Active coffees with current recipe + last shot, recent coffees, last shot overall |
| `GET /api/coffees?status=` | List with summary (shot count, avg/best score, roast age) |
| `POST /api/coffees` | Create (body includes `field_sources`, optional `image_ids` to attach) |
| `GET /api/coffees/:id` | Coffee + images + recipes + shots + best shot + current recipe |
| `PATCH /api/coffees/:id` | Edit fields / status |
| `POST /api/images` (multipart) | Upload a photo (`image_type`, optional `coffee_id`) |
| `POST /api/ai/extract-packaging` | `{ image_ids[], text? }` → extraction draft (not saved as a coffee) |
| `POST /api/ai/analyze-beans` | `{ image_id }` → observation (saved on the image) |
| `POST /api/coffees/:id/recipes/suggest` | `{ use_ai? }` → new `suggested` recipe |
| `POST /api/coffees/:id/recipes` | Manual recipe (incl. packaging recipe with `stated_ratio`) |
| `POST /api/recipes/:id/activate` | Make active, supersede previous |
| `POST /api/shots` | Log shot → returns saved shot + advice |
| `PATCH /api/shots/:id` | Edit tasting/notes/fields of a shot (shot only; recipes untouched) |
| `POST /api/shots/:id/advice` | `{ use_ai? }` → recompute advice |
| `POST /api/shots/:id/apply-advice` | Create the next recipe version from the stored advice and activate it |
| `GET /api/compare?ids=1,2` | Side-by-side data (stretch) |
| `GET/PUT /api/equipment`, `GET/PUT /api/settings` | Equipment and brew preferences |
| `GET /api/export` | Full JSON export (all tables) |
| `GET /api/status` | Version + whether AI is configured |

---

## 12. User interface

Mobile-first (designed at 390 px wide, works on iPad/desktop). Bottom navigation: **Home · Coffees · + Shot · Settings**. Large tap targets, number steppers, light/dark theme from the system.

### 12.1 Screens

| Screen | Contents |
|---|---|
| **Home** | Active coffee cards (name, roast age, current recipe `20 g → 40 g · 1:2 · 93 °C · 28–32 s`, last shot + score) with **Log shot** button; "Add coffee"; last shot overall with its advice; recently used coffees; link to historical/imported coffees |
| **Coffees** | Filter chips by status; list with shot count and best score |
| **Add coffee** | ① Take/upload packaging photo(s) and optional bean photo → ② "Read packaging" (AI) or "Enter manually" → ③ Review form with provenance labels, ratio warning for printed recipe, visual observations panel → ④ Save → offers starting recipe |
| **Coffee detail** | Facts with provenance badges and "Unknown" for empty fields; visual observations; photos; **Current recipe** card (+ rationale, "Use / Ask the barista / Edit"); **Best shot**; shot history (newest first: date, numbers, ratio, time, tags, score, roast age); recipe timeline (version, what changed, source, status); status actions (Mark active / finished / archive) |
| **Log shot** | Prefilled from the current recipe (dose, yield, temp, PI, grind). Steppers for the numbers, ratio shown live, timer field, tasting chips, score stars, optional text + quick-text parser. Save in < 30 s |
| **Advice** (after saving) | Headline, explanation, checks, next-shot parameters with the changed one highlighted; buttons **Use for next shot** / **Keep current recipe** |
| **Settings** | Equipment, brew preferences, AI status, export, "Unassigned historical shots" (assign to a coffee) |

### 12.2 The 30-second shot flow

Home → **Log shot** on the coffee card → numbers already filled → adjust time (and yield if different) → tap 1–3 taste chips → tap score → **Save** → advice shown → **Use for next shot**.

---

## 13. Seed data

Imported once on first start (idempotent, guarded by a `seed_version` in `meta`). All seven coffees get status **historical**, field sources **historical** unless stated otherwise below. Historical recipes are stored as `source = historical`, `status = suggested` — **suggestions, not confirmed results**.

| # | Coffee | Facts (source) | Recipes |
|---|---|---|---|
| 1 | Ethiopia Karamo Single Origin | Ethiopia; Arabica, Heirloom (variety); ≈2,000 m; Natural (packaging); roast date 2026-05-26; roast level light-medium (visual — note "light-medium to medium") | v1 **packaging**: 20 → 40 g, 28 s, `stated_ratio` 2.25 → flagged inconsistent (is 1:2; 1:2.25 = 45 g). v2 historical: 20 → 45 g (explore 44–46 g), 94 °C, 28–32 s |
| 2 | Roosevelt Ethiopian Natural | Roosevelt; Ethiopia; Natural; variety/roast date/roast level unknown | v1: 20 → 45 g (1:2.25), 94 °C (note "94–95 °C"), 28–32 s |
| 3 | Lazzio Luxe Blend (ALDI) | Lazzio; Peru, Colombia; 100% Arabica (in notes); medium | v1: 20 → 40 g, 93 °C, 28–32 s, PI 6–8 s |
| 4 | Manna Colombia Regional Cumbia | Manna Beans; Colombia; Washed; Caturra / Castillo; cupping 85.5; tasting notes (packaging): sweet, hazelnut, caramel, red apple, orange, molasses, rich, creamy, clean, bright acidity, medium-full body; roast date unknown (notes: "≈2 weeks before the June 2026 discussion"); roast level unknown | v1: 20 → 40 g, 93 °C, 28–32 s; rationale includes the suggested adjustments (sour→finer, bitter→coarser, heavy→42 g, lacking body→38 g) |
| 5 | 3 Beans | Name only; everything else unknown; roast level medium-dark (visual — "medium to medium-dark"); notes "described as fresh"; visual observations: some colour variation, mostly dry, a few beans with slight sheen | v1: 20 → 40 g, 92 °C, 27–30 s |
| 6 | Lazzio Brazil Single Origin (ALDI) | Lazzio; Brazil; Minas Gerais; medium (packaging); intensity 4/5; tasting notes toffee, bittersweet cocoa, milk chocolate (packaging) | v1: 20 → 40 g, 93 °C, 27–30 s, PI 5–8 s; rationale "expected chocolate/toffee, full body — expectation, not a result" |
| 7 | Lazzio Luxe Reserve Guatemala (ALDI) | Lazzio; Luxe Reserve; Guatemala; "high altitude"; "rich volcanic soils" + packaging description (notes); tasting notes fruit, chocolate; medium (visual); visual observations: medium, some colour variation, mostly dry, no widespread oil | v1: 20 → 40 g, 93 °C, 28–32 s, PI 5–8 s |

Where the handover says a value came from packaging/product info (Karamo processing, Brazil roast level/region/notes, Manna details, Guatemala notes), the source is `packaging`; otherwise `historical`. Visual estimates are `visual`.

**Equipment:** BDB BES920BSS, SGP, 58 mm portafilter (~20 g basket), 58.5 mm self-levelling tamper, WDT tool, puck screen.

**Historical shot:** 19.7 g → 39.5 g (1:2.01), 24 s, 90 °C, **coffee unknown** (`coffee_id = null`), note "Historical shot from earlier notes; not necessarily the current baseline." Shown under Settings → Unassigned shots, where you can assign it.

---

## 14. Build plan

| Milestone | Delivers | Handover phase |
|---|---|---|
| M0 | This spec approved | — |
| M1 Core | Schema, seed, shared engine + parser with unit tests, REST API with tests | 1–3 (backend) |
| M2 UI loop | Home, coffee list/detail, add/edit coffee (manual), recipe card, log shot, advice, history, settings, export | 1–3 (UI) — **MVP usable without AI** |
| M3 AI | Packaging extraction + review, bean analysis, recipe refinement, advice review | 1, 4 |
| M4 Polish | PWA manifest/icon, Playwright phone test, README (run + phone setup), comparison table (stretch) | 5 (partial) |

Each milestone is committed separately so you can try it before the next one.

---

## 15. Acceptance criteria → tests

| # | Criterion (handover §8) | Verified by |
|---|---|---|
| 1 | Add a coffee using a packaging photo | API test with mocked AI; manual test with a real photo |
| 2 | Review and correct AI-extracted info | UI: review form editable; source changes to `user` on edit |
| 3 | Upload beans photo, save visual observations | API test (mocked AI); observation panel |
| 4 | Recipe tailored to the BDB | Engine unit tests (roast table, temp bounds 86–96) |
| 5 | Log a shot in a few seconds | Playwright: prefilled form, ≤ 6 taps to save |
| 6 | Record sour/bitter/sweet/balanced… | Taste chips stored as tags |
| 7 | Concrete next-shot recommendation | Engine tests for every row of §8.3, incl. the handover examples (24 s sour → finer; 29 s sweet chocolate → keep, promising) |
| 8 | Complete history of a coffee | Coffee detail: shots, recipes timeline, roast age |
| 9 | Identify the best recipe so far | Best-shot rule test |
| 10 | Close/reopen without losing data | API test: restart server on same DB file |
| R1/R2 | Ratio never inconsistent; Karamo flagged | Unit tests: `1:2`, `1:2.25`, `1:2.01`; Karamo warning text |
| R3 | Recipe change never alters shots | API test: supersede recipe, shots unchanged |

---

## 16. Open questions (need your answer)

| # | Question | Proposed default |
|---|---|---|
| OPEN-1 | Where will the server run (home computer on Wi-Fi, always-on box + Tailscale, or cloud)? | Home computer / LAN, no login |
| OPEN-2 | Sour shot **within** the target time: raise temperature 1 °C, or grind finer anyway? | +1 °C (flow is already right) |
| OPEN-3 | Shot score scale: 1–5 stars or 1–10? | 1–5 |
| OPEN-4 | How do you record SGP grind settings — dial number only (e.g. 12), or also the inner burr (e.g. "12 / inner 5")? | Dial number + optional inner-burr field |
| OPEN-5 | Shot time: total time including pre-infusion, or from first drops? | Total, including pre-infusion (what the BDB timer shows) |
| OPEN-6 | Confirm the BDB temperature range/step you use (86–96 °C, 1 °C)? Do you also want to record pre-infusion power? | 86–96 °C, 1 °C; no PI power field |
| OPEN-7 | AI: OK to use the Claude API (needs an Anthropic API key; a few cents per photo/advice)? | Yes, optional, off until a key is set |
