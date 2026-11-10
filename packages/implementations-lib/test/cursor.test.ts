'use strict';

import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { InvalidCursorError } from 'common-types-lib';
import { decodeCursor, encodeCursor } from '../src/pagination/cursor';

type TestContext = {
  sortOrder: 'asc' | 'desc';
  filterA?: string;
  filterB?: string;
  filterList?: readonly string[];
};

const id = randomUUID();
const ctx: TestContext = {
  sortOrder: 'asc',
  filterA: 'a-1',
  filterB: 'b-1'
};

/** Builds a token by hand so tests can control the exact payload shape. */
const rawToken = (payload: unknown) =>
  Buffer.from(JSON.stringify(payload)).toString('base64url');

const rejectsAsDifferentQuery = (cursor: string, against: TestContext) =>
  assert.throws(() => decodeCursor(cursor, against), {
    name: 'InvalidCursorError',
    message: /issued for a different query/
  });

const rejectsAsMalformed = (cursor: string) =>
  assert.throws(() => decodeCursor(cursor, ctx), {
    name: 'InvalidCursorError',
    message: /Malformed cursor/
  });

describe('cursor', () => {
  test('round-trips the id when the context matches', () => {
    assert.equal(decodeCursor(encodeCursor(id, ctx), ctx), id);
  });

  test('is opaque: base64url, no raw id visible', () => {
    const cursor = encodeCursor(id, ctx);
    assert.match(cursor, /^[A-Za-z0-9_-]+$/);
    assert.ok(!cursor.includes(id));
  });

  test('rejects a cursor when sortOrder differs', () => {
    rejectsAsDifferentQuery(encodeCursor(id, ctx), {
      ...ctx,
      sortOrder: 'desc'
    });
  });

  test('rejects a cursor when a filter differs, is added, or is removed', () => {
    const cursor = encodeCursor(id, ctx);
    rejectsAsDifferentQuery(cursor, { ...ctx, filterA: 'a-2' });
    rejectsAsDifferentQuery(cursor, { ...ctx, filterA: undefined });

    // The reverse direction: issued unscoped, replayed with the filter on.
    const unscoped = encodeCursor(id, { ...ctx, filterA: undefined });
    rejectsAsDifferentQuery(unscoped, ctx);
  });

  test('a filter absent from the context still counts as a difference', () => {
    // JSON.stringify drops undefined, so a dropped filter is missing from the
    // token entirely rather than present-and-undefined. Comparing the union of
    // both sides' keys is what catches it.
    const cursor = rawToken({ id, ctx: { sortOrder: 'asc', filterA: 'a-1' } });
    rejectsAsDifferentQuery(cursor, ctx);
  });

  test('treats an absent optional filter and an undefined one as the same', () => {
    const partial: TestContext = { sortOrder: 'desc', filterA: 'a' };
    const cursor = encodeCursor(id, partial);
    assert.equal(decodeCursor(cursor, { ...partial, filterB: undefined }), id);
    assert.equal(decodeCursor(cursor, partial), id);
  });

  test('accepts a token regardless of context key order', () => {
    const reordered = rawToken({
      ctx: {
        filterB: ctx.filterB,
        filterA: ctx.filterA,
        sortOrder: ctx.sortOrder
      },
      id
    });
    assert.equal(decodeCursor(reordered, ctx), id);
  });

  test('rejects malformed cursors', () => {
    rejectsAsMalformed('not base64url json');
    rejectsAsMalformed(Buffer.from('{"nope"').toString('base64url'));
    rejectsAsMalformed(rawToken('just a string'));
    rejectsAsMalformed(rawToken({ ctx }));
    rejectsAsMalformed(rawToken({ id: 123, ctx }));
    rejectsAsMalformed(rawToken({ id }));
    rejectsAsMalformed(rawToken({ id, ctx: null }));
    rejectsAsMalformed(rawToken({ id, ctx: 'x' }));
    rejectsAsMalformed(rawToken({ id, ctx: 5 }));
    rejectsAsMalformed(rawToken({ id, ctx: [] }));
  });

  test('a list filter matches regardless of order or duplicates', () => {
    const listCtx: TestContext = { ...ctx, filterList: ['b', 'a'] };
    const cursor = encodeCursor(id, listCtx);

    assert.equal(decodeCursor(cursor, { ...ctx, filterList: ['a', 'b'] }), id);
    assert.equal(
      decodeCursor(cursor, { ...ctx, filterList: ['b', 'a', 'b'] }),
      id
    );
  });

  test('rejects a cursor when a list filter selects a different set', () => {
    const cursor = encodeCursor(id, { ...ctx, filterList: ['a', 'b'] });

    rejectsAsDifferentQuery(cursor, { ...ctx, filterList: ['a'] });
    rejectsAsDifferentQuery(cursor, { ...ctx, filterList: ['a', 'b', 'c'] });
    rejectsAsDifferentQuery(cursor, { ...ctx, filterList: [] });
    rejectsAsDifferentQuery(cursor, ctx);
  });

  test('treats an empty list filter as no filter at all', () => {
    const cursor = encodeCursor(id, { ...ctx, filterList: [] });

    assert.equal(decodeCursor(cursor, ctx), id);
    assert.equal(decodeCursor(cursor, { ...ctx, filterList: undefined }), id);
  });

  test('a single-item list filter is not the same query as a scalar one', () => {
    const cursor = encodeCursor(id, {
      sortOrder: ctx.sortOrder,
      filterList: ['a-1']
    });
    rejectsAsDifferentQuery(cursor, {
      sortOrder: ctx.sortOrder,
      filterA: 'a-1'
    });
  });

  test('a bare id (the pre-encoding format) is rejected, not silently accepted', () => {
    assert.throws(() => decodeCursor(id, ctx), InvalidCursorError);
  });
});
