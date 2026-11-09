'use strict';

import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { decodeCursor, encodeCursor } from 'implementations-lib';

import { CursorContext } from '../src/grpc/cursor.js';

const id = randomUUID();
const ctx: CursorContext = {
  sortOrder: 'asc',
  walletAddressId: 'wallet-1',
  paymentIntentId: 'intent-1'
};

const rejectsAsDifferentQuery = (cursor: string, against: CursorContext) =>
  assert.throws(() => decodeCursor(cursor, against), {
    name: 'InvalidCursorError',
    message: /issued for a different query/
  });

describe('payment page cursor', () => {
  test('rejects a cursor when walletAddressId differs, is added, or is removed', () => {
    const cursor = encodeCursor(id, ctx);
    rejectsAsDifferentQuery(cursor, { ...ctx, walletAddressId: 'wallet-2' });
    rejectsAsDifferentQuery(cursor, { ...ctx, walletAddressId: undefined });

    const unscoped = encodeCursor(id, { ...ctx, walletAddressId: undefined });
    rejectsAsDifferentQuery(unscoped, ctx);
  });

  test('rejects a cursor when paymentIntentId differs, is added, or is removed', () => {
    const cursor = encodeCursor(id, ctx);
    rejectsAsDifferentQuery(cursor, { ...ctx, paymentIntentId: 'intent-2' });
    rejectsAsDifferentQuery(cursor, { ...ctx, paymentIntentId: undefined });

    const noIntent = encodeCursor(id, { ...ctx, paymentIntentId: undefined });
    rejectsAsDifferentQuery(noIntent, ctx);
  });
});
