import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CursorContext, decodeCursor, encodeCursor } from '../src/grpc/cursor';

/**
 * Pure unit tests for the opaque cursor. Mirrors the payments bounded
 * context's cursor tests, adapted to the grant filters — this is the part
 * where a cursor replayed against a different query would silently return a
 * page anchored somewhere unrelated.
 */
describe('grant page cursor', () => {
  const base: CursorContext = { sortOrder: 'desc' };
  const id = 'f3c1e2a4-4b5d-4c6e-8a7f-1b2c3d4e5f60';

  it('round-trips the id when the context matches', () => {
    assert.equal(decodeCursor(encodeCursor(id, base), base), id);
  });

  it('is opaque: base64url, no raw id visible', () => {
    const cursor = encodeCursor(id, base);
    assert.ok(!cursor.includes(id));
    assert.match(cursor, /^[A-Za-z0-9_-]+$/);
  });

  it('rejects a cursor when sortOrder differs', () => {
    const cursor = encodeCursor(id, { sortOrder: 'asc' });
    assert.throws(() => decodeCursor(cursor, { sortOrder: 'desc' }), {
      name: 'InvalidCursorError'
    });
  });

  it('rejects a cursor when identifier differs, is added, or is removed', () => {
    const withId: CursorContext = {
      sortOrder: 'desc',
      identifier: 'https://test.com/alice'
    };
    assert.throws(() => decodeCursor(encodeCursor(id, withId), base), {
      name: 'InvalidCursorError'
    });
    assert.throws(() => decodeCursor(encodeCursor(id, base), withId), {
      name: 'InvalidCursorError'
    });
    assert.throws(
      () =>
        decodeCursor(encodeCursor(id, withId), {
          sortOrder: 'desc',
          identifier: 'https://test.com/bob'
        }),
      { name: 'InvalidCursorError' }
    );
  });

  it('rejects a cursor when state differs, is added, or is removed', () => {
    const withState: CursorContext = { sortOrder: 'desc', state: 'PENDING' };
    assert.throws(() => decodeCursor(encodeCursor(id, withState), base), {
      name: 'InvalidCursorError'
    });
    assert.throws(() => decodeCursor(encodeCursor(id, base), withState), {
      name: 'InvalidCursorError'
    });
    assert.throws(
      () =>
        decodeCursor(encodeCursor(id, withState), {
          sortOrder: 'desc',
          state: 'REVOKED'
        }),
      { name: 'InvalidCursorError' }
    );
  });

  it('treats an absent optional filter and an undefined one as the same', () => {
    const cursor = encodeCursor(id, {
      sortOrder: 'desc',
      identifier: undefined
    });
    assert.equal(decodeCursor(cursor, base), id);
  });

  it('accepts a token regardless of context key order', () => {
    const payload = JSON.stringify({
      id,
      ctx: {
        state: 'PENDING',
        identifier: 'https://test.com/alice',
        sortOrder: 'desc'
      }
    });
    const cursor = Buffer.from(payload).toString('base64url');
    assert.equal(
      decodeCursor(cursor, {
        sortOrder: 'desc',
        identifier: 'https://test.com/alice',
        state: 'PENDING'
      }),
      id
    );
  });

  it('rejects malformed cursors', () => {
    for (const bad of [
      '',
      'not-base64!!',
      Buffer.from('{').toString('base64url')
    ]) {
      assert.throws(() => decodeCursor(bad, base), {
        name: 'InvalidCursorError'
      });
    }
  });

  it('a bare id (the pre-encoding format) is rejected, not silently accepted', () => {
    assert.throws(() => decodeCursor(id, base), { name: 'InvalidCursorError' });
  });
});
