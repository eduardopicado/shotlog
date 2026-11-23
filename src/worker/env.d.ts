// Secrets and test-only bindings that `wrangler types` can't see.
interface ShotlogExtraEnv {
  /** Secret. Set with `wrangler secret put ANTHROPIC_API_KEY` or in the dashboard. */
  ANTHROPIC_API_KEY?: string;
  /** Optional override, only for local testing against a fake API. */
  ANTHROPIC_BASE_URL?: string;
  /** Only in tests: D1 migrations read by vitest.config.ts. */
  TEST_MIGRATIONS?: import('cloudflare:test').D1Migration[];
}
interface Env extends ShotlogExtraEnv {}
declare namespace Cloudflare {
  interface Env extends ShotlogExtraEnv {}
}
