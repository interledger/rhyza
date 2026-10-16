'use strict';

import { after, before, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { Db, MongoClient } from 'mongodb';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { ConsoleLogger } from 'common-types-lib';
import { IGrant } from 'auth-domain-lib';
import { MongoDbGrantRepo } from '../src';

const MONGO_IMAGE = 'mongo:8';
const MONGO_PORT = 27017;

// Fixed time so (createdAt, id) ordering is deterministic.
const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const ALICE = 'https://test.com/alice';
const BOB = 'https://test.com/bob';

/**
 * Covers the keyset pagination added for grants. Deliberately not a port of
 * the payments repo's suite — just enough to show the cursor walks the index
 * correctly in both directions and that the filters compose with it.
 */
describe('MongoDbGrantRepo keyset pagination', () => {
  let container: StartedTestContainer;
  let client: MongoClient;
  let db: Db;
  let repo: MongoDbGrantRepo;
  let ids: string[];

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
    db = client.db('auth');

    repo = new MongoDbGrantRepo(url, new ConsoleLogger());
    await repo.init();
  });

  after(async () => {
    const results = await Promise.allSettled([
      repo?.destroy(),
      client?.close(),
      container?.stop()
    ]);
    const failure = results.find((r) => r.status === 'rejected');
    if (failure && failure.status === 'rejected') throw failure.reason;
  });

  function makeGrant(args: {
    id: string;
    createdAt: Date;
    state?: IGrant['state'];
    identifier?: string;
  }): IGrant {
    return {
      id: args.id,
      createdAt: args.createdAt,
      state: args.state ?? 'PENDING',
      accesses: [
        {
          type: 'OUTGOING_PAYMENT',
          actions: ['CREATE'],
          identifier: args.identifier ?? ALICE
        }
      ],
      accessTokens: []
    };
  }

  beforeEach(async () => {
    await Promise.all([
      db.collection('grants').deleteMany({}),
      db.collection('access_tokens').deleteMany({})
    ]);

    // five grants, one minute apart, sorted ids so ties are predictable
    ids = Array.from({ length: 5 }, () => randomUUID()).sort();
    await repo.storeMany(
      ids.map((id, i) =>
        makeGrant({
          id,
          createdAt: new Date(T0 + i * 60_000),
          state: i === 0 ? 'REVOKED' : 'PENDING',
          identifier: i === 4 ? BOB : ALICE
        })
      )
    );
  });

  const pageIds = (p: { items: IGrant[] }) => p.items.map((g) => g.id);

  test('defaults to newest first', async () => {
    const page = await repo.fetchGrantsPage({ limit: 10, backwards: false });
    assert.deepEqual(pageIds(page), [...ids].reverse());
    assert.equal(page.hasNextPage, false);
    assert.equal(page.hasPreviousPage, false);
  });

  test('asc walks forward and reports more pages', async () => {
    const first = await repo.fetchGrantsPage({
      limit: 2,
      backwards: false,
      sortOrder: 'asc'
    });
    assert.deepEqual(pageIds(first), ids.slice(0, 2));
    assert.equal(first.hasNextPage, true);
    assert.equal(first.hasPreviousPage, false);

    const second = await repo.fetchGrantsPage({
      limit: 2,
      backwards: false,
      sortOrder: 'asc',
      cursor: ids[1]
    });
    assert.deepEqual(pageIds(second), ids.slice(2, 4));
    assert.equal(second.hasPreviousPage, true);
  });

  test('backwards returns the window before the cursor, same order', async () => {
    const back = await repo.fetchGrantsPage({
      limit: 2,
      backwards: true,
      sortOrder: 'asc',
      cursor: ids[3]
    });
    assert.deepEqual(pageIds(back), ids.slice(1, 3));
  });

  test('filters by state', async () => {
    const page = await repo.fetchGrantsPage({
      limit: 10,
      backwards: false,
      state: 'REVOKED'
    });
    assert.deepEqual(pageIds(page), [ids[0]]);
  });

  test('filters by granted identifier, not client', async () => {
    const page = await repo.fetchGrantsPage({
      limit: 10,
      backwards: false,
      identifier: BOB
    });
    assert.deepEqual(pageIds(page), [ids[4]]);
  });

  test('state and identifier filters compose', async () => {
    const page = await repo.fetchGrantsPage({
      limit: 10,
      backwards: false,
      state: 'PENDING',
      identifier: ALICE
    });
    assert.deepEqual(pageIds(page), [...ids.slice(1, 4)].reverse());
  });

  test('unknown cursor is rejected', async () => {
    await assert.rejects(
      () =>
        repo.fetchGrantsPage({
          limit: 10,
          backwards: false,
          cursor: randomUUID()
        }),
      /Unknown cursor/
    );
  });

  test('non-positive limit is rejected', async () => {
    await assert.rejects(
      () => repo.fetchGrantsPage({ limit: 0, backwards: false }),
      /limit must be a positive integer/
    );
  });
});
