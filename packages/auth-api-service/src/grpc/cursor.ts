import { GrantState, InvalidCursorError, SortOrder } from 'auth-domain-lib';

/**
 * The query a cursor was issued for. Each field changes which position a
 * boundary id refers to, so a cursor is only meaningful against the same set.
 *
 * Duplicated from the payments bounded context rather than shared, pending a
 * decision on whether the two should converge.
 */
export interface CursorContext {
  sortOrder: SortOrder;
  identifier?: string;
  state?: GrantState;
}

const CONTEXT_KEYS = ['sortOrder', 'identifier', 'state'] as const;

/**
 * Cursors are opaque so a caller cannot reuse one against a different sortOrder
 * or filter and silently get a page anchored to an unrelated position.
 */
export function encodeCursor(id: string, ctx: CursorContext): string {
  return Buffer.from(JSON.stringify({ id, ctx })).toString('base64url');
}

/** Boundary id, or throws if the cursor was issued for a different query. */
export function decodeCursor(cursor: string, ctx: CursorContext): string {
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

  // compared field by field, order doesnt matter
  const issued = decoded.ctx;
  const matches = CONTEXT_KEYS.every(
    (key) => (issued[key] ?? null) === (ctx[key] ?? null)
  );

  if (!matches) {
    throw new InvalidCursorError(
      'Cursor was issued for a different query; sortOrder and filters must stay the same while paginating'
    );
  }

  return decoded.id;
}
