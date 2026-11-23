import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig({
  test: {
    projects: [
      // Pure domain logic (engine, ratio maths, parser) — plain Node.
      { test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' } },
      // The API, running inside Cloudflare's local Workers runtime with local D1 + R2.
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations('./migrations'),
                AUTH_DISABLED: 'true',
              },
            },
          })),
        ],
        test: { name: 'api', include: ['tests/api/**/*.test.ts'], setupFiles: ['./tests/api/setup.ts'] },
      },
    ],
  },
});
