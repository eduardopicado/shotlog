import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../app';

// Packaging extraction and bean analysis (spec §9.2) arrive in milestone M4.
export const ai = new Hono<AppEnv>();

ai.post('/*', () => {
  throw new HTTPException(503, { message: 'AI features are not available yet. Enter the details manually for now.' });
});
