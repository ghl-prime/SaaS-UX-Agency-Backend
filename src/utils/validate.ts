import type { z } from 'zod';
import { ApiError } from './ApiError.js';

/** Parse `input` with `schema`, throwing a 400 with field-level issues on failure. */
export function validate<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    // Lead with the first problem so the admin UI can show something actionable.
    const first = result.error.issues[0];
    const field = first?.path.join('.');
    const friendly = first ? (first.message.startsWith('Invalid') && field ? `${field}: ${first.message}` : first.message) : 'Validation failed';
    throw ApiError.badRequest(
      friendly,
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}
