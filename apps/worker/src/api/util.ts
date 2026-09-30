import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';

/** Parses and validates a JSON body; 400 on bad input. */
export async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: 'invalid_json' });
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw new HTTPException(400, { message: 'validation_error' });
  return result.data;
}

/** Positive integer route param; 404 otherwise. */
export function idParam(c: Context, name = 'id'): number {
  const n = Number(c.req.param(name));
  if (!Number.isSafeInteger(n) || n <= 0) throw new HTTPException(404, { message: 'not_found' });
  return n;
}
