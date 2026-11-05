import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodeCursor, encodeCursor } from 'implementations-lib';

import { CursorContext } from '../src/grpc/cursor';

describe('grant page cursor', () => {
  const base: CursorContext = { sortOrder: 'desc' };
  const id = 'f3c1e2a4-4b5d-4c6e-8a7f-1b2c3d4e5f60';

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
});
