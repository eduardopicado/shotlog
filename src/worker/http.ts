import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';

/** Parses and validates a JSON body; ZodErrors become 400s in app.onError. */
export async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: 'Body must be JSON' });
  }
  return schema.parse(raw);
}

export function idParam(c: Context, name = 'id'): number {
  const id = Number(c.req.param(name));
  if (!Number.isInteger(id) || id <= 0) throw new HTTPException(400, { message: `Invalid ${name}` });
  return id;
}

export function notFound(what: string): never {
  throw new HTTPException(404, { message: `${what} not found` });
}
