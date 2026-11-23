import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { body } from '../http';
import { toImage } from '../db';
import { analyzeBeans, extractPackaging } from '../ai/service';

// AI endpoints (spec §9.2). Results are drafts/observations for you to review — nothing
// here creates or edits a coffee by itself.
export const ai = new Hono<AppEnv>();

type ImageRow = { id: number; r2_key: string; content_type: string; image_type: string; coffee_id: number | null };

async function loadImages(db: D1Database, ids: number[]): Promise<ImageRow[]> {
  if (!ids.length) return [];
  const { results } = await db.prepare(`SELECT id, r2_key, content_type, image_type, coffee_id FROM coffee_images WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids).all<ImageRow>();
  if (results.length !== new Set(ids).size) throw new HTTPException(404, { message: 'Photo not found' });
  return ids.map((id) => results.find((r) => r.id === id)!);
}

/** Read the bag: returns a draft for the review screen and keeps the raw AI output on the photos. */
ai.post('/extract-packaging', async (c) => {
  const input = await body(c, z.object({ image_ids: z.array(z.number().int().positive()).min(1).max(4), text: z.string().max(4000).nullable().optional() }));
  const images = await loadImages(c.env.DB, input.image_ids);
  const { draft, raw } = await extractPackaging(c.env, images, input.text);
  await c.env.DB.batch(images.map((img) => c.env.DB.prepare('UPDATE coffee_images SET ai_observations = ? WHERE id = ?')
    .bind(JSON.stringify({ kind: 'packaging_extraction', at: new Date().toISOString(), output: raw }), img.id)));
  return c.json(draft);
});

/** Describe the beans: the observation is saved on the photo (separate from coffee facts). */
ai.post('/analyze-beans', async (c) => {
  const { image_id } = await body(c, z.object({ image_id: z.number().int().positive() }));
  const [image] = await loadImages(c.env.DB, [image_id]);
  const observation = await analyzeBeans(c.env, image);
  const row = await c.env.DB.prepare("UPDATE coffee_images SET ai_observations = ?, image_type = 'beans' WHERE id = ? RETURNING *")
    .bind(JSON.stringify(observation), image_id).first();
  return c.json({ observation, image: toImage(row!) });
});
