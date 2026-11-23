import { applyD1Migrations, env } from 'cloudflare:test';

// Schema + seed (migrations/0001, 0002) applied to the test database.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS!);
