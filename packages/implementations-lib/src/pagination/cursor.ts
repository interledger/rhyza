import { InvalidCursorError } from 'common-types-lib';

/**
 * Opaque keyset cursors, shared by every bounded context that paginates.
 *
 * A cursor is only a boundary id, which means nothing on its own — the same id
 * sits at a different position under a different sort order or filter. So the
 * query it was issued for travels with it and is checked on the way back in,
 * rather than trusting the caller to keep paginating the same set.
 */

/** Cursors are base64url so a caller cannot read or hand-craft a position. */
export function encodeCursor<C extends object>(id: string, ctx: C): string {
  return Buffer.from(JSON.stringify({ id, ctx })).toString('base64url');
}

/** Boundary id, or throws if the cursor was issued for a different query. */
export function decodeCursor<C extends object>(cursor: string, ctx: C): string {
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

  // Compared field by field, so key order doesn't matter. The keys come from
  // both sides: a filter that was dropped since the cursor was issued has to
  // count as a difference too, not just one whose value changed.
  const issued = decoded.ctx;
  const current = ctx as Record<string, unknown>;
  const keys = new Set([...Object.keys(issued), ...Object.keys(current)]);
  const matches = [...keys].every(
    (key) => (issued[key] ?? null) === (current[key] ?? null)
  );

  if (!matches) {
    throw new InvalidCursorError(
      'Cursor was issued for a different query; sortOrder and filters must stay the same while paginating'
    );
  }

  return decoded.id;
}
