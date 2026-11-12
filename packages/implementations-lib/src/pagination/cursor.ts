import { InvalidCursorError } from 'common-types-lib';

/**
 * Opaque keyset cursors, shared by every bounded context that paginates.
 *
 * A cursor is only a boundary id, which means nothing on its own — the same id
 * sits at a different position under a different sort order or filter. So the
 * query it was issued for travels with it and is checked on the way back in,
 * rather than trusting the caller to keep paginating the same set.
 */

export type CursorContextValue =
  | string
  | number
  | boolean
  | readonly string[]
  | undefined;

export type CursorContext = Record<string, CursorContextValue>;

/**
 * Cursors are base64url so a caller cannot read or hand-craft a position.
 *
 * TODO: consider storing a hash of the context instead of the context itself,
 * so cursors stay small whatever the filter (for example 50+ wallet addresses).
 */
export function encodeCursor<C extends CursorContext>(
  id: string,
  ctx: C
): string {
  return Buffer.from(JSON.stringify({ id, ctx })).toString('base64url');
}

/** Boundary id, or throws if the cursor was issued for a different query. */
export function decodeCursor<C extends CursorContext>(
  cursor: string,
  ctx: C
): string {
  let decoded: { id?: unknown; ctx?: Record<string, unknown> };
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError(`Malformed cursor: ${cursor}`);
  }

  if (
    typeof decoded?.id !== 'string' ||
    typeof decoded.ctx !== 'object' ||
    decoded.ctx === null ||
    Array.isArray(decoded.ctx)
  ) {
    throw new InvalidCursorError(`Malformed cursor: ${cursor}`);
  }

  if (_canonicalize(decoded.ctx) !== _canonicalize(ctx)) {
    throw new InvalidCursorError(
      'Cursor was issued for a different query; sortOrder and filters must stay the same while paginating'
    );
  }

  return decoded.id;
}

/**
 * Order-independent string form of a context, for equality checks.
 * Empty fields are dropped so they compare equal to absent ones.
 */
function _canonicalize(ctx: Record<string, unknown>): string {
  const entries = Object.keys(ctx)
    .sort()
    .map((key) => [key, _canonicalizeValue(ctx[key])] as const)
    .filter(([, value]) => value !== null);

  return JSON.stringify(entries);
}

/** Arrays are `$in` sets: order and duplicates are ignored, and empty means absent. */
function _canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const set = [...new Set(value)].sort();
    return set.length === 0 ? null : set;
  }
  return value ?? null;
}
