import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../app';
import { body, idParam, notFound } from '../http';
import { imageUpdateSchema } from '../schemas';
import { toImage } from '../db';
import { IMAGE_TYPES, type ImageType } from '../../shared/types';

export const images = new Hono<AppEnv>();

const MAX_BYTES = 8 * 1024 * 1024; // photos are resized on the phone first; this is a safety net
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Upload a photo (multipart: file, image_type, optional coffee_id) to R2. */
images.post('/', async (c) => {
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) throw new HTTPException(400, { message: 'Missing file' });
  if (!ALLOWED.has(file.type)) throw new HTTPException(415, { message: 'Use a JPEG, PNG or WebP image' });
  if (file.size > MAX_BYTES) throw new HTTPException(413, { message: 'Image is larger than 8 MB' });
  const imageType = String(form.image_type ?? 'other') as ImageType;
  if (!IMAGE_TYPES.includes(imageType)) throw new HTTPException(400, { message: 'Invalid image_type' });
  const coffeeId = form.coffee_id ? Number(form.coffee_id) : null;
  if (coffeeId != null && !Number.isInteger(coffeeId)) throw new HTTPException(400, { message: 'Invalid coffee_id' });

  const now = new Date();
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const key = `img/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${ext}`;
  await c.env.PHOTOS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const row = await c.env.DB.prepare(
    'INSERT INTO coffee_images (coffee_id, r2_key, content_type, image_type) VALUES (?, ?, ?, ?) RETURNING *',
  ).bind(coffeeId, key, file.type, imageType).first();
  return c.json(toImage(row!), 201);
});

images.get('/:id/file', async (c) => {
  const row = await c.env.DB.prepare('SELECT r2_key, content_type FROM coffee_images WHERE id = ?').bind(idParam(c)).first<{ r2_key: string; content_type: string }>();
  if (!row) notFound('Image');
  const obj = await c.env.PHOTOS.get(row.r2_key);
  if (!obj) notFound('Image file');
  return new Response(obj.body, {
    headers: { 'Content-Type': row.content_type, 'Cache-Control': 'private, max-age=31536000, immutable' },
  });
});

images.patch('/:id', async (c) => {
  const id = idParam(c);
  const changes = await body(c, imageUpdateSchema);
  const cols = Object.keys(changes) as Array<keyof typeof changes>;
  if (!cols.length) throw new HTTPException(400, { message: 'Nothing to update' });
  const row = await c.env.DB.prepare(`UPDATE coffee_images SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ? RETURNING *`)
    .bind(...cols.map((k) => changes[k] ?? null), id).first();
  if (!row) notFound('Image');
  return c.json(toImage(row));
});

images.delete('/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT r2_key FROM coffee_images WHERE id = ?').bind(idParam(c)).first<{ r2_key: string }>();
  if (!row) notFound('Image');
  await c.env.PHOTOS.delete(row.r2_key);
  await c.env.DB.prepare('DELETE FROM coffee_images WHERE r2_key = ?').bind(row.r2_key).run();
  return c.body(null, 204);
});
