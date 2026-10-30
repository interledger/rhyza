'use strict';

import { after, before, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { Collection, Db, MongoClient } from 'mongodb';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { IPageOpts, SortOrder } from 'common-types-lib';
import { fetchPageDocs } from '../../src/mongo/pagination';

const MONGO_IMAGE = 'mongo:8';
const MONGO_PORT = 27017;
const COLLECTION = 'pageables';

// Fixed instant so (createdAt, id) ordering is deterministic.
const T0 = Date.parse('2026-01-01T00:00:00.000Z');

/** A minimal pageable record: the two sort-key fields plus one filterable. */
interface Doc {
  id: string;
  createdAt: Date;
  group?: string;
}

/**
 * Keyset pagination, independent of any bounded context. Bounded contexts
 * should cover their own filters and projections.
 */
describe('fetchPageDocs keyset pagination', () => {
  let container: StartedTestContainer;
  let client: MongoClient;
  let db: Db;
  let collection: Collection<Doc>;

  before(async () => {
    try {
      container = await new GenericContainer(MONGO_IMAGE)
        .withExposedPorts(MONGO_PORT)
        .start();
    } catch (e) {
      throw new Error(
        `Could not start ${MONGO_IMAGE} via testcontainers. ` +
          `This integration test needs a running Docker daemon. ` +
          `Cause: ${(e as Error).message}`
      );
    }
    const url = `mongodb://${container.getHost()}:${container.getMappedPort(MONGO_PORT)}`;
    client = new MongoClient(url);
    await client.connect();
    db = client.db('pagination_test');
    collection = db.collection<Doc>(COLLECTION);
    await collection.createIndex({ group: 1, createdAt: 1, id: 1 });
  });

  after(async () => {
    const results = await Promise.allSettled([
      client?.close(),
      container?.stop()
    ]);
    const failure = results.find((r) => r.status === 'rejected');
    if (failure && failure.status === 'rejected') throw failure.reason;
  });

  /** Sorted so a tie on createdAt breaks predictably by id. */
  let ids: string[];

  async function seed(
    count: number,
    opts: { sameInstant?: boolean; group?: (i: number) => string } = {}
  ): Promise<string[]> {
    const made = Array.from({ length: count }, () => randomUUID()).sort();
    await collection.insertMany(
      made.map((id, i) => ({
        id,
        createdAt: new Date(opts.sameInstant ? T0 : T0 + i * 60_000),
        ...(opts.group ? { group: opts.group(i) } : {})
      }))
    );
    return made;
  }

  beforeEach(async () => {
    await collection.deleteMany({});
    ids = await seed(5);
  });

  const page = (
    opts: Partial<IPageOpts> & { filter?: Record<string, unknown> } = {}
  ) =>
    fetchPageDocs(collection, opts.filter ?? {}, {
      limit: 10,
      backwards: false,
      ...opts
    });
  const got = (p: { items: Doc[] }) => p.items.map((d) => d.id);

  // These tests rely on Mongo ordering UUIDs the way JS does when createdAt
  // ties. This is what makes the (createdAt, id) tiebreak predictable.
  test('MongoDB sorts UUIDs the same way JS does', async () => {
    await collection.deleteMany({});
    const tied = await seed(5, { sameInstant: true });
    const expected = [...tied].sort();

    assert.deepEqual(got(await page({ sortOrder: 'asc' })), expected);
    assert.deepEqual(
      got(await page({ sortOrder: 'desc' })),
      [...expected].reverse()
    );
  });

  describe('order', () => {
    test('defaults to descending (newest first) when omitted', async () => {
      assert.deepEqual(got(await page()), [...ids].reverse());
    });

    test('desc is the exact reverse of asc', async () => {
      const asc = got(await page({ sortOrder: 'asc' }));
      const desc = got(await page({ sortOrder: 'desc' }));
      assert.deepEqual(desc, [...asc].reverse());
    });
  });

  describe('page flags', () => {
    test('both false when one page holds everything', async () => {
      const p = await page({ sortOrder: 'asc' });
      assert.equal(p.hasNextPage, false);
      assert.equal(p.hasPreviousPage, false);
    });

    test('hasNextPage true at the start, false at the end', async () => {
      const first = await page({ sortOrder: 'asc', limit: 2 });
      assert.deepEqual(got(first), ids.slice(0, 2));
      assert.equal(first.hasNextPage, true);
      assert.equal(first.hasPreviousPage, false);

      const last = await page({ sortOrder: 'asc', limit: 2, cursor: ids[2] });
      assert.deepEqual(got(last), ids.slice(3, 5));
      assert.equal(last.hasNextPage, false);
      assert.equal(last.hasPreviousPage, true);
    });
  });

  describe('cursors', () => {
    test('forward returns the window after the cursor', async () => {
      const p = await page({ sortOrder: 'asc', limit: 2, cursor: ids[1] });
      assert.deepEqual(got(p), ids.slice(2, 4));
    });

    test('backwards returns the window before the cursor, same order', async () => {
      const p = await page({
        sortOrder: 'asc',
        limit: 2,
        backwards: true,
        cursor: ids[3]
      });
      assert.deepEqual(got(p), ids.slice(1, 3));
    });

    test('desc backwards returns the window after the cursor, still desc', async () => {
      const desc = [...ids].reverse();
      const p = await page({
        sortOrder: 'desc',
        limit: 2,
        backwards: true,
        cursor: desc[3]
      });
      assert.deepEqual(got(p), desc.slice(1, 3));
    });

    test('splits a createdAt tie by id, forward and backward', async () => {
      await collection.deleteMany({});
      const tied = await seed(5, { sameInstant: true });

      const fwd = await page({ sortOrder: 'asc', limit: 2, cursor: tied[1] });
      assert.deepEqual(got(fwd), tied.slice(2, 4));

      const back = await page({
        sortOrder: 'asc',
        limit: 2,
        backwards: true,
        cursor: tied[3]
      });
      assert.deepEqual(got(back), tied.slice(1, 3));
    });

    test('unknown cursor throws InvalidCursorError', async () => {
      await assert.rejects(() => page({ cursor: randomUUID() }), {
        name: 'InvalidCursorError'
      });
    });
  });

  describe('walking every page', () => {
    for (const sortOrder of ['asc', 'desc'] as SortOrder[]) {
      for (const limit of [1, 2, 5]) {
        test(`${sortOrder}, limit ${limit}, forward then backward`, async () => {
          const expected = sortOrder === 'asc' ? ids : [...ids].reverse();

          const forward: string[] = [];
          let cursor: string | undefined;
          let hasNextPage = true;
          while (hasNextPage) {
            const p = await page({ sortOrder, limit, cursor });
            forward.push(...got(p));
            cursor = p.items[p.items.length - 1]?.id;
            hasNextPage = p.hasNextPage;
          }
          assert.deepEqual(forward, expected, 'forward walk');

          // Start backward from the last item; the cursor is exclusive, so
          // that item is never returned by a page and seeds the result.
          const last = expected[expected.length - 1];
          const backward: string[] = [last];
          cursor = last;
          let hasPreviousPage = true;
          while (hasPreviousPage) {
            const p = await page({
              sortOrder,
              limit,
              backwards: true,
              cursor
            });
            backward.unshift(...got(p));
            cursor = p.items[0]?.id;
            hasPreviousPage = p.hasPreviousPage;
          }
          assert.deepEqual(backward, expected, 'backward walk');
        });
      }
    }
  });

  describe('filters compose with the cursor', () => {
    beforeEach(async () => {
      await collection.deleteMany({});
      ids = await seed(6, { group: (i) => (i % 2 === 0 ? 'even' : 'odd') });
    });

    test('scoped excludes other groups', async () => {
      const p = await page({ sortOrder: 'asc', filter: { group: 'even' } });
      assert.deepEqual(got(p), [ids[0], ids[2], ids[4]]);
    });

    test('unknown filter value yields an empty page', async () => {
      const p = await page({ sortOrder: 'asc', filter: { group: 'nope' } });
      assert.deepEqual(got(p), []);
      assert.equal(p.hasNextPage, false);
      assert.equal(p.hasPreviousPage, false);
    });

    test('a cursor outside the filter still pages the matching set', async () => {
      // ids[1] is in 'odd', so it is not a member of the filtered set; the
      // boundary is still a valid position in (createdAt, id) space.
      const p = await page({
        sortOrder: 'asc',
        filter: { group: 'even' },
        cursor: ids[1]
      });
      assert.deepEqual(got(p), [ids[2], ids[4]]);
    });

    test('paging through a filtered set covers it without gaps', async () => {
      const seen: string[] = [];
      let cursor: string | undefined;
      let hasNextPage = true;
      while (hasNextPage) {
        const p = await page({
          sortOrder: 'asc',
          limit: 1,
          cursor,
          filter: { group: 'even' }
        });
        seen.push(...got(p));
        cursor = p.items[p.items.length - 1]?.id;
        hasNextPage = p.hasNextPage;
      }
      assert.deepEqual(seen, [ids[0], ids[2], ids[4]]);
    });
  });

  describe('limit validation', () => {
    for (const limit of [0, -1, 1.5, NaN]) {
      test(`limit ${limit} throws InvalidArgument`, async () => {
        await assert.rejects(() => page({ limit }), {
          name: 'InvalidArgument'
        });
      });
    }
  });

  test('empty collection yields an empty page', async () => {
    await collection.deleteMany({});
    const p = await page({ sortOrder: 'asc' });
    assert.deepEqual(got(p), []);
    assert.equal(p.hasNextPage, false);
    assert.equal(p.hasPreviousPage, false);
  });
});
