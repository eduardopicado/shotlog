# Shotlog

Personal coffee journal and espresso dial-in assistant for a Breville Dual Boiler + Smart Grinder Pro.

> Add a coffee → get a recipe → log a shot → get the next adjustment.

* **Spec:** [docs/SPEC.md](docs/SPEC.md) — every rule, field and screen.
* **Cloudflare guide:** [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md) — what each piece is and how to deploy from a browser.

## Status

| Milestone | State |
|---|---|
| M1 Core — Worker API, D1 schema + seed, dial-in engine | ✅ done, tested |
| M2 UI loop — home, coffees, add/edit, recipes, log shot, advice, settings, export | ✅ done, phone smoke test |
| M3 First deploy to Cloudflare | ⏳ you, guided by docs/CLOUDFLARE.md §4 |
| M4 AI — read the bag, describe beans, AI recipe + advice review, spend caps | ✅ built and tested against a fake Claude API; first real call happens once you add a key |
| M5 Polish | ⏳ |

## How it's built

```
src/shared/   domain logic used by both sides: types, ratio maths, recipe + dial-in engine, quick-text parser
src/worker/   Cloudflare Worker: Hono REST API on D1 (SQLite) and R2 (photos), Access token check
src/worker/ai Claude calls: prompts, output schemas, validation, daily cap, usage/cost log
src/web/      React app (mobile-first PWA), built by Vite into dist/ and served by the Worker
migrations/   D1 schema (0001) and the imported coffees/equipment/historical shot (0002)
tests/unit/   engine, ratio, parser
tests/api/    API tests running inside Cloudflare's local Workers runtime
scripts/      phone-size end-to-end tests (Playwright) and a fake Claude API for local AI testing
```

Key rules (spec §3): the ratio is always computed from dose and yield; printed ratios are checked
(the Karamo "1:2.25, 20 g → 40 g" bag is flagged); recipes (plans) and shots (what happened) are separate
and shots are never rewritten; every coffee fact shows where it came from; nothing is guessed; one variable
changes per adjustment; imported coffees aren't "in stock" until you say so; the app works without AI.

## Run it locally

Needs Node 22+. No Cloudflare account needed for local development.

```bash
npm install
cp .dev.vars.example .dev.vars   # AUTH_DISABLED=true for local use
npm run preview                  # builds the app, sets up the local database, serves http://localhost:8787
```

For UI work with hot reload: `npm run dev` (Vite on :5173, API on :8787).

```bash
npm test             # unit + API tests (AI tests use a fake client: no network, no cost)
npm run typecheck
node scripts/e2e-smoke.cjs http://127.0.0.1:8787   # with `npm run preview` running
```

To try the AI screens locally without spending anything, run `node scripts/fake-claude.cjs`, put
`ANTHROPIC_API_KEY=sk-fake` and `ANTHROPIC_BASE_URL=http://127.0.0.1:8788` in `.dev.vars`, start
`npm run preview`, then `node scripts/e2e-ai.cjs`. With a real key in `.dev.vars` (and no base URL), the
same screens call Claude for real.

Local data lives in `.wrangler/` (git-ignored). Delete it to start again from the seed.

## Deploy

See [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md) §4. In short: connect this repo in Cloudflare
(Workers & Pages → Import a repository), let it create the D1 database and R2 bucket, protect the
`workers.dev` URL with Cloudflare Access, then open it on your iPhone and "Add to Home Screen".
