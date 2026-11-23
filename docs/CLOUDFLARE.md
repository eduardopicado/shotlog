# Cloudflare for Shotlog — a learning guide

What each Cloudflare piece is, why Shotlog uses it, and how to set it up from a browser.
Figures marked *approx.* came from memory and still need checking against the linked docs
(the docs site couldn't be reached from the session that wrote this).

---

## 1. The mental model

A normal web app runs on **a server you rent** (a computer that's always on). Cloudflare Workers flip that:
you upload **code**, and Cloudflare runs it **on demand** in its data centres, close to wherever the request comes from.
Nothing is running while nobody uses the app, and that's why it can be free.

```
Your phone ──HTTPS──► Cloudflare edge ──► Access (are you allowed in?)
                                     └──► Worker (your code) ──► D1 / R2 / Claude API
```

| Piece | Think of it as | Shotlog uses it for |
|---|---|---|
| **Worker** | A function that runs for each request | The API (`/api/...`) and serving the web app |
| **Static assets** | Files served straight from Cloudflare's cache | The built React app (HTML/JS/CSS/icons) |
| **D1** | A hosted SQLite database | Coffees, recipes, shots, settings, AI usage |
| **R2** | Hosted file storage (like Amazon S3) | Photos of bags, beans and shots |
| **Bindings** | Named handles the Worker gets to D1/R2/etc. — no connection strings, no passwords | `env.DB`, `env.PHOTOS`, `env.ASSETS` |
| **Secrets** | Encrypted environment variables, never shown again after saving | `ANTHROPIC_API_KEY` |
| **Wrangler** | Cloudflare's command-line tool and config file (`wrangler.jsonc`) | Local dev, migrations, deploy |
| **Access** (part of Cloudflare Zero Trust) | A login gate in front of a URL | Only you can open Shotlog |
| **Workers Builds** | Cloudflare's built-in CI: watches a GitHub repo and deploys on push | Deploy without a computer |

---

## 2. Key concepts in a bit more depth

### Workers run in isolates, not containers
Each request runs in a lightweight sandbox (a V8 isolate, same engine as Chrome), which starts in milliseconds.
Consequences for how the code is written:
* **No local disk.** Data goes in D1/R2, never in files.
* **No native Node modules.** `better-sqlite3` (used in the first draft) can't run, so the code talks to D1 instead.
  Express is replaced by **Hono**, a router built for this environment.
* **CPU time is limited per request** (*approx.* 10 ms on the free plan), but **time spent waiting** (for D1, R2 or
  Claude to answer) doesn't count. Shotlog's heavy lifting is waiting, so it fits. The one CPU-heavy step,
  encoding a photo for Claude, is kept small by resizing photos on the phone first.
* `nodejs_compat` is a compatibility flag that enables common Node APIs (like `Buffer`) inside Workers.

### D1 is SQLite, managed
Same SQL as SQLite. Schema changes are **migrations**: numbered `.sql` files in `migrations/`.
`wrangler d1 migrations apply` runs the ones not yet applied, in order, and records them, so the seed data in
`0002_seed.sql` runs exactly once.
**Time Travel** lets you restore the database to an earlier point (*approx.* 7 days back on free). The app's JSON
export is the long-term backup.

### R2 is object storage
Files are stored by **key** (like a path: `img/2026/11/abc.jpg`). The bucket stays private, and the Worker reads a
photo and streams it to you after Access has checked who you are. R2 charges no egress fees.

### Static assets + Worker in one deployment
Wrangler uploads the built web app as assets. Requests for real files (`/assets/app.js`) are served directly,
`/api/*` goes to your Worker code (`run_worker_first`), and any other path (e.g. `/coffees/3`) returns
`index.html` so the React router can handle it (`not_found_handling: "single-page-application"`).

### Access: login without writing auth code
Access sits in front of the URL. The first time you open Shotlog it asks for your email and sends a one-time code,
and after that a cookie keeps you signed in. Access adds a signed token (`Cf-Access-Jwt-Assertion` header) to
every request. The Worker **verifies that token** too, so even a misconfiguration can't expose the API.

### Workers Builds: deploy from GitHub
Connect the GitHub repo once in the dashboard. On every push to `main`, Cloudflare checks out the code, installs,
builds, applies D1 migrations and deploys. You can watch the build log in the dashboard, and roll back to an
earlier deployment with one click.

---

## 3. Free-plan limits (approx. — verify)

| Service | Free allowance (approx.) | Docs |
|---|---|---|
| Workers | ~100,000 requests/day, ~10 ms CPU/request | https://developers.cloudflare.com/workers/platform/limits/ |
| D1 | ~5 GB storage, ~5 M rows read/day, ~100 k rows written/day, Time Travel ~7 days | https://developers.cloudflare.com/d1/platform/limits/ |
| R2 | ~10 GB-month storage, ~1 M Class A + ~10 M Class B operations/month, free egress | https://developers.cloudflare.com/r2/pricing/ |
| Access (Zero Trust) | Free for small teams (~50 users) | https://www.cloudflare.com/plans/zero-trust-services/ |
| Workers Builds | Free build minutes per month | https://developers.cloudflare.com/workers/ci-cd/builds/ |

Shotlog's expected use is a tiny fraction of each. If a free limit is ever hit, that service pauses until the daily
or monthly reset. Nothing gets billed unless you add a payment method and move to a paid plan.

---

## 4. Setup (milestone M3), all from a browser

You'll do these once; the code side (wrangler config, migrations) will already be in the repo.

1. **Create a Cloudflare account** at dash.cloudflare.com (free plan, no card needed).
2. **Create the D1 database**: *Storage & Databases → D1 → Create* → name `shotlog`. Copy its **Database ID**
   (it goes into `wrangler.jsonc`; I'll make that commit).
3. **Create the R2 bucket**: *R2 → Create bucket* → `shotlog-photos` (keep it private). R2 may ask you to
   accept its terms first.
4. **Create the Worker from GitHub**: *Workers & Pages → Create → Import a repository* → pick `shotlog`.
   Build settings: build command `npm run build`, deploy command
   `npx wrangler d1 migrations apply shotlog --remote && npx wrangler deploy`.
5. **Turn on Access for the workers.dev URL**: in the Worker's *Settings → Domains & Routes*, enable Cloudflare
   Access on `workers.dev` (and on preview URLs). Allow only your email address. Copy the **Audience (AUD) tag** and
   your **team domain** into the Worker variables `ACCESS_AUD` / `ACCESS_TEAM_DOMAIN`.
6. **(M4) Add the Claude API key**: *Worker → Settings → Variables and Secrets → Add → Secret* →
   `ANTHROPIC_API_KEY`. See §6 for creating a capped key first.
7. **Open it on the iPhone**: visit the workers.dev URL, sign in with the email code, then
   Share → **Add to Home Screen**.

Optional, from a computer: `npx wrangler login` lets you run the same steps from a terminal
(`wrangler d1 create`, `wrangler r2 bucket create`, `wrangler secret put`, `wrangler deploy`).

---

## 5. Local development (what I use while building)

```
npm install
npm run dev        # wrangler dev: runs the Worker locally with a local D1 and a local R2 (no account needed)
npm test           # engine + API tests, running inside Cloudflare's local runtime
```

The local database and photos live in `.wrangler/` (git-ignored) and never touch the deployed app.

---

## 6. Capping Claude API spend

Anthropic's Console has the controls; the app adds its own on top (spec §9.4).

1. **Prepaid credits, auto-reload off.** API usage draws from credits you bought; when they run out, calls stop.
   Leave automatic reload switched off.
2. **A dedicated workspace with a spend limit.** In console.anthropic.com create a workspace (e.g. `shotlog`),
   set its **monthly spend limit** (e.g. $5) and create the API key **inside that workspace**. The key can then
   never spend more than that workspace's limit, even if it leaked.
3. **Keep the key in one place:** only as the Cloudflare secret. Never in GitHub, the browser or a chat.
   If in doubt, delete the key in the Console and create a new one. That takes 30 seconds.
4. **In-app caps:** 30 AI calls/day by default, small per-call token limits, and the month-to-date estimate in
   Settings. Expected spend is about $0.30/month, so a $5 limit is a generous ceiling.

When a limit is reached, the API returns an error. Shotlog shows "AI unavailable" and keeps working with the
built-in rules.
