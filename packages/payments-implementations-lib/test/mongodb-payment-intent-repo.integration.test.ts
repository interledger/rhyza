'use strict';

import { after, before, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { Db, MongoClient } from 'mongodb';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { ConsoleLogger, InvalidArgument } from 'common-types-lib';
import {
  InvalidCursorError,
  IPaymentIntent,
  IQuote,
  ISentPayment,
  SortOrder
} from 'payments-domain-lib';
import { MongoDbPaymentIntentRepo } from '../src';

const MONGO_IMAGE = 'mongo:8';
const MONGO_PORT = 27017;
const DB_NAME = 'payments';
const COLLECTIONS = ['paymentIntents', 'sentPayments', 'inboundPayments'];

// Using fixed time to controll order, createdAt ties
const T0 = Date.parse('2026-01-01T00:00:00.000Z');

const RECEIVER_WALLET = 'receiver-wallet';
const OTHER_RECEIVER_WALLET = 'other-receiver-wallet';
const SENDER_WALLET = 'sender-wallet';
const OTHER_SENDER_WALLET = 'other-sender-wallet';

describe('MongoDbPaymentIntentRepo keyset pagination', () => {
  let container: StartedTestContainer;
  let client: MongoClient;
  let db: Db;
  let repo: MongoDbPaymentIntentRepo;

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
    db = client.db(DB_NAME);

    repo = new MongoDbPaymentIntentRepo(url, new ConsoleLogger());
    await repo.init();
  });

  beforeEach(async () => {
    await Promise.all(
      COLLECTIONS.map((name) => db.collection(name).deleteMany({}))
    );
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

  /**
   * Creates and sorts (asc) `n` UUIDs.
   * intentId(1) < intentId(2) etc.
   *
   * Page order is determined by createdAt with id as tiebreaker. This establishes
   * an expected order.
   *
   * IMPORTANT: This relies on Mongo ordering strings the way JS does. Which
   * should be tested in this suite (see `MongoDB sorts UUIDs the same way JS does`)
   */
  const sortedUUIDs = (n: number): { ids: string[]; at(i: number): string } => {
    const ids = Array.from({ length: n }, () => randomUUID()).sort();
    return { ids, at: (i: number) => ids[i - 1] };
  };

  const { ids: INTENTS_ASC, at: intentId } = sortedUUIDs(6);
  const { ids: PAYMENTS_ASC, at: paymentId } = sortedUUIDs(5);
  const otherIntentId = randomUUID();
  const otherPaymentId = randomUUID();

  function makeIntent(args: {
    id: string;
    walletAddressId: string;
    createdAt: Date;
  }): IPaymentIntent {
    return {
      id: args.id,
      receiverWalletAddressId: args.walletAddressId,
      receiverWalletAddress: 'test.com/page-receiver',
      state: 'CREATED',
      destination: 'LOCAL',
      assetCode: 'USD',
      assetScale: 2,
      createdAt: args.createdAt,
      expiresAt: new Date(T0 + 86_400_000),
      incomingAmount: 100n,
      receivedAmount: 0n,
      quotes: [],
      sentPayments: [],
      inboundPayments: []
    };
  }

  function makeSentPayment(args: {
    id: string;
    paymentIntentId: string;
    createdAt: Date;
    senderWalletAddressId?: string;
  }): ISentPayment {
    return {
      id: args.id,
      state: 'CREATED',
      senderWalletAddress: 'test.com/page-sender',
      senderWalletAddressId: args.senderWalletAddressId ?? SENDER_WALLET,
      paymentIntentId: args.paymentIntentId,
      assetCode: 'USD',
      assetScale: 2,
      createdAt: args.createdAt,
      debitAmount: 100n,
      receiveAmount: 100n,
      sentAmount: 0n,
      destination: 'LOCAL'
    };
  }

  /**
   * A sample dataset that most tests run against.
   *
   * Intents in ascending order (by `createdAt` with `id` as tie):
   *   otherIntent     T0-1     OTHER_RECEIVER_WALLET
   *   intentId(1)     T0       RECEIVER_WALLET
   *   intentId(2)     T0+1     RECEIVER_WALLET
   *   intentId(3)     T0+2     RECEIVER_WALLET         (tie)
   *   intentId(4)     T0+2     RECEIVER_WALLET         (tie)
   *   intentId(5)     T0+3     RECEIVER_WALLET
   *   intentId(6)     T0+4     RECEIVER_WALLET
   *
   * Sent payments, in (createdAt, id) ascending order:
   *   otherPayment    T0-1     OTHER_SENDER_WALLET  -> otherIntent
   *   paymentId(1)    T0       SENDER_WALLET        -> intentId(1)
   *   paymentId(2)    T0+1     SENDER_WALLET        -> intentId(2)
   *   paymentId(3)    T0+2     SENDER_WALLET        -> intentId(1)   (tie)
   *   paymentId(4)    T0+2     SENDER_WALLET        -> intentId(2)   (tie)
   *   paymentId(5)    T0+3     SENDER_WALLET        -> intentId(1)
   *
   * The "other" rows belong to wallets other than the one we will filter by.
   * They should be excluded by the filter.
   */
  async function seed() {
    const otherIntent = makeIntent({
      id: otherIntentId,
      walletAddressId: OTHER_RECEIVER_WALLET,
      createdAt: new Date(T0 - 1)
    });
    const intents = [
      makeIntent({
        id: intentId(1),
        walletAddressId: RECEIVER_WALLET,
        createdAt: new Date(T0)
      }),
      makeIntent({
        id: intentId(2),
        walletAddressId: RECEIVER_WALLET,
        createdAt: new Date(T0 + 1)
      }),
      makeIntent({
        id: intentId(3),
        walletAddressId: RECEIVER_WALLET,
        createdAt: new Date(T0 + 2)
      }),
      makeIntent({
        id: intentId(4),
        walletAddressId: RECEIVER_WALLET,
        createdAt: new Date(T0 + 2)
      }),
      makeIntent({
        id: intentId(5),
        walletAddressId: RECEIVER_WALLET,
        createdAt: new Date(T0 + 3)
      }),
      makeIntent({
        id: intentId(6),
        walletAddressId: RECEIVER_WALLET,
        createdAt: new Date(T0 + 4)
      })
    ];
    await repo.storeMany([otherIntent, ...intents]);

    const [intent1, intent2] = intents;
    otherIntent.sentPayments = [
      makeSentPayment({
        id: otherPaymentId,
        paymentIntentId: otherIntent.id,
        senderWalletAddressId: OTHER_SENDER_WALLET,
        createdAt: new Date(T0 - 1)
      })
    ];
    intent1.sentPayments = [
      makeSentPayment({
        id: paymentId(1),
        paymentIntentId: intent1.id,
        createdAt: new Date(T0)
      }),
      makeSentPayment({
        id: paymentId(3),
        paymentIntentId: intent1.id,
        createdAt: new Date(T0 + 2)
      }),
      makeSentPayment({
        id: paymentId(5),
        paymentIntentId: intent1.id,
        createdAt: new Date(T0 + 3)
      })
    ];
    intent2.sentPayments = [
      makeSentPayment({
        id: paymentId(2),
        paymentIntentId: intent2.id,
        createdAt: new Date(T0 + 1)
      }),
      makeSentPayment({
        id: paymentId(4),
        paymentIntentId: intent2.id,
        createdAt: new Date(T0 + 2)
      })
    ];
    await repo.storeSentPayments(
      [otherIntent, intent1, intent2].map((paymentIntent) => ({
        paymentIds: paymentIntent.sentPayments.map((p) => p.id),
        paymentIntent
      }))
    );
  }

  const ids = (page: { items: { id: string }[] }) =>
    page.items.map((i) => i.id);

  /** Reads a stored intent's createdAt, to check a tie really exists. */
  async function storedCreatedAt(id: string): Promise<number> {
    const doc = await db.collection('paymentIntents').findOne({ id });
    assert.ok(doc, `intent ${id} not stored`);
    return doc.createdAt.getTime();
  }

  type PageFetcher = (opts: {
    cursor?: string;
    limit: number;
    backwards: boolean;
  }) => Promise<{
    items: { id: string }[];
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  }>;

  /**
   * Walks through the full results in both directions and verifies that
   * pagination always reconstructs `expected` exactly, with the same ordering
   * and no gaps or duplicates across page boundaries.
   */
  async function assertWalk(
    fetch: PageFetcher,
    limit: number,
    expected: string[]
  ) {
    const forward: string[] = [];
    let cursor: string | undefined;
    let hasNextPage = true;
    while (hasNextPage) {
      const page = await fetch({ cursor, limit, backwards: false });
      forward.push(...ids(page));
      cursor = page.items.at(-1)?.id;
      hasNextPage = page.hasNextPage;
    }
    assert.deepEqual(forward, expected, 'forward walk');

    // Start backward from the last item; that item is the boundary and is
    // excluded from the pages, so it seeds the result.
    const last = expected[expected.length - 1];
    const backward: string[] = [last];
    cursor = last;
    let hasPreviousPage = true;
    while (hasPreviousPage) {
      const page = await fetch({ cursor, limit, backwards: true });
      backward.unshift(...ids(page));
      cursor = page.items[0]?.id;
      hasPreviousPage = page.hasPreviousPage;
    }
    assert.deepEqual(backward, expected, 'backward walk');
  }

  // IMPORTANT: these tests rely on mongo ordering UUIDs
  // like JS (in case of ties). This test verifies that.
  test('MongoDB sorts UUIDs the same way JS does', async () => {
    const uuids = [1, 2, 3, 4, 5].map(() => randomUUID());
    // Identical createdAt for every doc, so ordering is decided purely by id.
    const sameInstant = new Date(T0);
    await repo.storeMany(
      uuids.map((id) =>
        makeIntent({
          id,
          walletAddressId: RECEIVER_WALLET,
          createdAt: sameInstant
        })
      )
    );

    const expected = [...uuids].sort();
    const asc = await repo.fetchPaymentIntentsPage({
      walletAddressId: RECEIVER_WALLET,
      sortOrder: 'asc',
      limit: 10,
      backwards: false
    });
    assert.deepEqual(ids(asc), expected);

    const desc = await repo.fetchPaymentIntentsPage({
      walletAddressId: RECEIVER_WALLET,
      limit: 10,
      backwards: false,
      sortOrder: 'desc'
    });
    assert.deepEqual(ids(desc), [...expected].reverse());
  });

  describe('fetchPaymentIntentsPage', () => {
    beforeEach(seed);

    test('returns all items in filtered by wallet address in ascending order (by createdAt, id)', async () => {
      const page = await repo.fetchPaymentIntentsPage({
        walletAddressId: RECEIVER_WALLET,
        sortOrder: 'asc',
        limit: 10,
        backwards: false
      });
      assert.deepEqual(ids(page), INTENTS_ASC);
      assert.equal(page.hasNextPage, false);
      assert.equal(page.hasPreviousPage, false);
    });

    test('hasNextPage is false when the page reaches the end and true when more items remain', async () => {
      const exact = await repo.fetchPaymentIntentsPage({
        walletAddressId: RECEIVER_WALLET,
        sortOrder: 'asc',
        limit: 6,
        backwards: false
      });
      assert.equal(exact.items.length, 6);
      assert.equal(exact.hasNextPage, false);

      const under = await repo.fetchPaymentIntentsPage({
        walletAddressId: RECEIVER_WALLET,
        sortOrder: 'asc',
        limit: 5,
        backwards: false
      });
      assert.equal(under.items.length, 5);
      assert.equal(under.hasNextPage, true);
    });

    test('forward cursor splits a createdAt tie by id', async () => {
      // 3 and 4 have same createdAt.
      assert.equal(
        await storedCreatedAt(intentId(3)),
        await storedCreatedAt(intentId(4))
      );

      // Page from 3 should incude 4 on and page from 4 should not include 3
      const afterEarlier = await repo.fetchPaymentIntentsPage({
        walletAddressId: RECEIVER_WALLET,
        sortOrder: 'asc',
        cursor: intentId(3),
        limit: 10,
        backwards: false
      });
      assert.deepEqual(ids(afterEarlier), [
        intentId(4),
        intentId(5),
        intentId(6)
      ]);

      const afterLater = await repo.fetchPaymentIntentsPage({
        walletAddressId: RECEIVER_WALLET,
        sortOrder: 'asc',
        cursor: intentId(4),
        limit: 10,
        backwards: false
      });
      assert.deepEqual(ids(afterLater), [intentId(5), intentId(6)]);
    });

    test('backwards returns the window immediately before the cursor, ascending', async () => {
      const page = await repo.fetchPaymentIntentsPage({
        walletAddressId: RECEIVER_WALLET,
        sortOrder: 'asc',
        cursor: intentId(6),
        limit: 2,
        backwards: true
      });
      assert.deepEqual(ids(page), [intentId(4), intentId(5)]);
      assert.equal(page.hasPreviousPage, true);
      assert.equal(page.hasNextPage, true);
    });

    test('backwards cursor splits a createdAt tie by id', async () => {
      // 3 and 4 have same createdAt.
      assert.equal(
        await storedCreatedAt(intentId(3)),
        await storedCreatedAt(intentId(4))
      );

      // Mirror of the forward case: backwards from the later member (4)
      // includes the earlier (3); backwards from (3) must not include (4).
      // Page backwards from 4 should include 1-3, from 3 should include 1-2
      const beforeLater = await repo.fetchPaymentIntentsPage({
        walletAddressId: RECEIVER_WALLET,
        sortOrder: 'asc',
        cursor: intentId(4),
        limit: 10,
        backwards: true
      });
      assert.deepEqual(ids(beforeLater), [
        intentId(1),
        intentId(2),
        intentId(3)
      ]);
      assert.equal(beforeLater.hasPreviousPage, false);
      assert.equal(beforeLater.hasNextPage, true);

      const beforeEarlier = await repo.fetchPaymentIntentsPage({
        walletAddressId: RECEIVER_WALLET,
        sortOrder: 'asc',
        cursor: intentId(3),
        limit: 10,
        backwards: true
      });
      assert.deepEqual(ids(beforeEarlier), [intentId(1), intentId(2)]);
      assert.equal(beforeEarlier.hasPreviousPage, false);
      assert.equal(beforeEarlier.hasNextPage, true);
    });

    test('limit below 1 or non-integer throws InvalidArgument', async () => {
      for (const limit of [0, -1, 1.5]) {
        await assert.rejects(
          repo.fetchPaymentIntentsPage({
            walletAddressId: RECEIVER_WALLET,
            sortOrder: 'asc',
            limit,
            backwards: false
          }),
          InvalidArgument,
          `limit ${limit}`
        );
      }
    });

    test('unknown cursor throws InvalidCursorError', async () => {
      await assert.rejects(
        repo.fetchPaymentIntentsPage({
          walletAddressId: RECEIVER_WALLET,
          sortOrder: 'asc',
          cursor: randomUUID(),
          limit: 2,
          backwards: false
        }),
        InvalidCursorError
      );
    });

    test('empty collection yields an empty page', async () => {
      await Promise.all(
        COLLECTIONS.map((name) => db.collection(name).deleteMany({}))
      );
      const page = await repo.fetchPaymentIntentsPage({
        sortOrder: 'asc',
        limit: 10,
        backwards: false
      });
      assert.deepEqual(page.items, []);
      assert.equal(page.hasNextPage, false);
      assert.equal(page.hasPreviousPage, false);
    });

    describe('walletAddressId filter', () => {
      test('unscoped returns every wallet', async () => {
        const page = await repo.fetchPaymentIntentsPage({
          sortOrder: 'asc',
          limit: 10,
          backwards: false
        });
        assert.deepEqual(ids(page), [otherIntentId, ...INTENTS_ASC]);
      });

      test('no wallet filter gets all intents', async () => {
        await assertWalk(
          (opts) => repo.fetchPaymentIntentsPage({ sortOrder: 'asc', ...opts }),
          3,
          [otherIntentId, ...INTENTS_ASC]
        );
      });

      test('scoped excludes other wallet addresses', async () => {
        const page = await repo.fetchPaymentIntentsPage({
          walletAddressId: OTHER_RECEIVER_WALLET,
          sortOrder: 'asc',
          limit: 10,
          backwards: false
        });
        assert.deepEqual(ids(page), [otherIntentId]);
      });

      test('unknown wallet address yields an empty page', async () => {
        const page = await repo.fetchPaymentIntentsPage({
          walletAddressId: 'no-such-wallet',
          sortOrder: 'asc',
          limit: 10,
          backwards: false
        });
        assert.deepEqual(page.items, []);
        assert.equal(page.hasNextPage, false);
        assert.equal(page.hasPreviousPage, false);
      });

      test('cursor from another wallet still returns all matching intents', async () => {
        const page = await repo.fetchPaymentIntentsPage({
          walletAddressId: RECEIVER_WALLET,
          sortOrder: 'asc',
          cursor: otherIntentId,
          limit: 10,
          backwards: false
        });
        assert.deepEqual(ids(page), INTENTS_ASC);
      });
    });
  });

  describe('walking every page', () => {
    beforeEach(seed);

    // limit 2 over 6 intents / 5 payments gives a first, middle and last
    // page, and a page boundary that lands on the createdAt tie at (4).
    test('intents asc', () =>
      assertWalk(
        (opts) =>
          repo.fetchPaymentIntentsPage({
            walletAddressId: RECEIVER_WALLET,
            sortOrder: 'asc',
            ...opts
          }),
        2,
        INTENTS_ASC
      ));

    test('intents desc', () =>
      assertWalk(
        (opts) =>
          repo.fetchPaymentIntentsPage({
            walletAddressId: RECEIVER_WALLET,
            sortOrder: 'desc',
            ...opts
          }),
        2,
        [...INTENTS_ASC].reverse()
      ));

    test('payments asc', () =>
      assertWalk(
        (opts) =>
          repo.fetchSentPaymentsPage({
            walletAddressId: SENDER_WALLET,
            sortOrder: 'asc',
            ...opts
          }),
        2,
        PAYMENTS_ASC
      ));

    test('payments desc', () =>
      assertWalk(
        (opts) =>
          repo.fetchSentPaymentsPage({
            walletAddressId: SENDER_WALLET,
            sortOrder: 'desc',
            ...opts
          }),
        2,
        [...PAYMENTS_ASC].reverse()
      ));
  });

  describe('sortOrder', () => {
    beforeEach(seed);

    test('All sortOrder/backwards combinations', async () => {
      const window = async (sortOrder: SortOrder, backwards: boolean) =>
        ids(
          await repo.fetchPaymentIntentsPage({
            walletAddressId: RECEIVER_WALLET,
            cursor: intentId(3),
            limit: 2,
            backwards,
            sortOrder
          })
        );

      // Ascending order is intentId(1)..intentId(6). cursor is intentId(3).
      assert.deepEqual(await window('asc', false), [intentId(4), intentId(5)]);
      assert.deepEqual(await window('asc', true), [intentId(1), intentId(2)]);
      assert.deepEqual(await window('desc', false), [intentId(2), intentId(1)]);
      assert.deepEqual(await window('desc', true), [intentId(5), intentId(4)]);
    });

    test('defaults to descending (newest first) when omitted', async () => {
      const page = await repo.fetchPaymentIntentsPage({
        walletAddressId: RECEIVER_WALLET,
        limit: 10,
        backwards: false
      });
      assert.deepEqual(ids(page), [...INTENTS_ASC].reverse());
    });

    test('desc is the exact reverse of asc', async () => {
      const asc = await repo.fetchPaymentIntentsPage({
        walletAddressId: RECEIVER_WALLET,
        sortOrder: 'asc',
        limit: 10,
        backwards: false
      });
      const desc = await repo.fetchPaymentIntentsPage({
        walletAddressId: RECEIVER_WALLET,
        limit: 10,
        backwards: false,
        sortOrder: 'desc'
      });
      assert.deepEqual(ids(desc), ids(asc).reverse());
    });

    test('desc backwards returns the window after the cursor, still desc', async () => {
      // Paging backward through a descending list moves towards *newer*
      // items, and the returned page stays in descending order.
      const page = await repo.fetchPaymentIntentsPage({
        walletAddressId: RECEIVER_WALLET,
        cursor: intentId(3),
        limit: 2,
        backwards: true,
        sortOrder: 'desc'
      });
      assert.deepEqual(ids(page), [intentId(5), intentId(4)]);
      assert.equal(page.hasNextPage, true);
      assert.equal(page.hasPreviousPage, true);
    });

    test('desc splits a createdAt tie by id, mirroring asc', async () => {
      const asc = await repo.fetchPaymentIntentsPage({
        walletAddressId: RECEIVER_WALLET,
        sortOrder: 'asc',
        cursor: intentId(3),
        limit: 2,
        backwards: false
      });
      const desc = await repo.fetchPaymentIntentsPage({
        walletAddressId: RECEIVER_WALLET,
        cursor: intentId(3),
        limit: 2,
        backwards: true,
        sortOrder: 'desc'
      });
      // Same window, opposite traversal: forward-from-cursor in asc equals
      // backward-from-cursor in desc, reversed.
      assert.deepEqual(ids(desc), ids(asc).reverse());
    });
  });

  describe('fetchSentPaymentsPage', () => {
    beforeEach(seed);

    test('returns all items in (createdAt, id) ascending order', async () => {
      const page = await repo.fetchSentPaymentsPage({
        walletAddressId: SENDER_WALLET,
        sortOrder: 'asc',
        limit: 10,
        backwards: false
      });
      assert.deepEqual(ids(page), PAYMENTS_ASC);
      assert.equal(page.hasNextPage, false);
      assert.equal(page.hasPreviousPage, false);
      for (const payment of page.items) {
        assert.equal(payment.senderWalletAddressId, SENDER_WALLET);
        assert.equal(Number(payment.debitAmount), 100);
      }
    });

    test('unknown cursor throws InvalidCursorError', async () => {
      await assert.rejects(
        repo.fetchSentPaymentsPage({
          walletAddressId: SENDER_WALLET,
          sortOrder: 'asc',
          cursor: randomUUID(),
          limit: 2,
          backwards: false
        }),
        InvalidCursorError
      );
    });

    describe('filters', () => {
      test('unscoped returns every sender, oldest first', async () => {
        const page = await repo.fetchSentPaymentsPage({
          sortOrder: 'asc',
          limit: 10,
          backwards: false
        });
        assert.deepEqual(ids(page), [otherPaymentId, ...PAYMENTS_ASC]);
      });

      test('unscoped pages walk every sender without gaps', async () => {
        await assertWalk(
          (opts) => repo.fetchSentPaymentsPage({ sortOrder: 'asc', ...opts }),
          2,
          [otherPaymentId, ...PAYMENTS_ASC]
        );
      });

      test('walletAddressId excludes other senders', async () => {
        const page = await repo.fetchSentPaymentsPage({
          walletAddressId: OTHER_SENDER_WALLET,
          sortOrder: 'asc',
          limit: 10,
          backwards: false
        });
        assert.deepEqual(ids(page), [otherPaymentId]);
      });

      test('paymentIntentId, alone and combined with walletAddressId and a cursor', async () => {
        const byIntent = await repo.fetchSentPaymentsPage({
          sortOrder: 'asc',
          paymentIntentId: intentId(2),
          limit: 10,
          backwards: false
        });
        assert.deepEqual(ids(byIntent), [paymentId(2), paymentId(4)]);

        const both = await repo.fetchSentPaymentsPage({
          walletAddressId: SENDER_WALLET,
          sortOrder: 'asc',
          paymentIntentId: intentId(1),
          limit: 10,
          backwards: false
        });
        assert.deepEqual(ids(both), [paymentId(1), paymentId(3), paymentId(5)]);

        const afterFirst = await repo.fetchSentPaymentsPage({
          walletAddressId: SENDER_WALLET,
          sortOrder: 'asc',
          paymentIntentId: intentId(1),
          cursor: paymentId(1),
          limit: 10,
          backwards: false
        });
        assert.deepEqual(ids(afterFirst), [paymentId(3), paymentId(5)]);
      });
    });
  });

  describe('hydrating payments', () => {
    /**
     * A payment row carries no destination -- that is the parent intent's
     * fact, supplied on read. These cover the rows that cannot be hydrated
     * because they contradict what the parent says.
     */
    async function insertRow(
      intent: IPaymentIntent,
      row: Record<string, unknown>
    ): Promise<void> {
      await repo.storeMany([intent]);
      await db.collection('sentPayments').insertOne({
        state: 'CREATED',
        senderWalletAddress: 'test.com/page-sender',
        senderWalletAddressId: SENDER_WALLET,
        paymentIntentId: intent.id,
        assetCode: 'USD',
        assetScale: 2,
        createdAt: new Date(T0),
        debitAmount: 100n,
        sentAmount: 0n,
        ...row
      });
    }

    test('a remote intent whose payment row has no peerId is rejected', async () => {
      const intent: IPaymentIntent = {
        ...makeIntent({
          id: randomUUID(),
          walletAddressId: RECEIVER_WALLET,
          createdAt: new Date(T0)
        }),
        destination: 'REMOTE',
        receiverWalletAddressId: undefined,
        destinationIlpAddress: 'g.peer.123'
      };
      await insertRow(intent, { id: randomUUID(), receiveAmount: 100n });

      await assert.rejects(
        () => repo.fetchByIdsWithPayments([intent.id]),
        /has no peerId/
      );
    });

    test('a local intent whose payment row has a null receiveAmount is rejected', async () => {
      const intent = makeIntent({
        id: randomUUID(),
        walletAddressId: RECEIVER_WALLET,
        createdAt: new Date(T0)
      });
      await insertRow(intent, { id: randomUUID(), receiveAmount: null });

      await assert.rejects(
        () => repo.fetchByIdsWithPayments([intent.id]),
        /has no receiveAmount/
      );
    });
  });

  describe('storeQuotes', () => {
    // Two handler instances can quote one remote intent at the same time.
    // Each request is Kafka-keyed by a fresh id, so the commands land on
    // different partitions. Both read the stored intent, append their own
    // quote, and flush. Each write must keep the other quote.
    function makeRemoteIntent(): IPaymentIntent {
      return {
        id: randomUUID(),
        receiverWalletAddress: 'remote.example.com/alice',
        state: 'CREATED',
        destination: 'REMOTE',
        assetCode: 'USD',
        assetScale: 2,
        createdAt: new Date(T0),
        expiresAt: new Date(T0 + 60_000),
        incomingAmount: null,
        receivedAmount: 0n,
        quotes: [],
        sentPayments: [],
        inboundPayments: [],
        destinationIlpAddress: 'g.peer.123',
        remoteUrl: `https://remote.example.com/incoming-payments/${randomUUID()}`
      };
    }

    function makePendingQuote(): IQuote {
      return {
        id: randomUUID(),
        state: 'PENDING',
        senderWalletAddress: 'local.example.com/bob',
        senderWalletAddressId: randomUUID(),
        createdAt: new Date(T0),
        route: {
          peerId: 'peer-1',
          peerAssetCode: 'USD',
          peerAssetScale: 2,
          sourceAmount: 100n,
          senderAssetCode: 'USD'
        }
      };
    }

    test('two writers adding a quote to one intent each keep their quote', async () => {
      const intent = makeRemoteIntent();
      await repo.storeMany([intent]);

      const [readA] = await repo.fetchByIdsWithPayments([intent.id]);
      const [readB] = await repo.fetchByIdsWithPayments([intent.id]);

      const quoteA = makePendingQuote();
      const quoteB = makePendingQuote();
      readA.quotes.push(quoteA);
      readB.quotes.push(quoteB);

      await repo.storeQuotes([readA]);
      await repo.storeQuotes([readB]);

      const [stored] = await repo.fetchByIdsWithPayments([intent.id]);
      assert.deepEqual(
        stored.quotes.map((q) => q.id).sort(),
        [quoteA.id, quoteB.id].sort()
      );
    });
  });

  describe('expiry', () => {
    const NOW = new Date(T0 + 60_000);

    function makeIntentExpiringAt(
      expiresAt: Date,
      state: IPaymentIntent['state'] = 'CREATED'
    ): IPaymentIntent {
      return {
        ...makeIntent({
          id: randomUUID(),
          walletAddressId: RECEIVER_WALLET,
          createdAt: new Date(T0)
        }),
        state,
        expiresAt
      };
    }

    function makeRemoteIntent(): IPaymentIntent {
      return {
        ...makeIntent({
          id: randomUUID(),
          walletAddressId: RECEIVER_WALLET,
          createdAt: new Date(T0)
        }),
        destination: 'REMOTE',
        receiverWalletAddressId: undefined,
        destinationIlpAddress: 'g.peer.123'
      };
    }

    /** Stores a remote payment, then moves it to `state` as prepare would. */
    async function storeRemotePayment(args: {
      state: ISentPayment['state'];
      expiresAt?: Date;
    }): Promise<{ paymentIntentId: string; paymentId: string }> {
      const intent = makeRemoteIntent();
      const paymentId = randomUUID();
      intent.sentPayments = [
        {
          id: paymentId,
          state: 'PROCESSING',
          senderWalletAddress: 'test.com/page-sender',
          senderWalletAddressId: SENDER_WALLET,
          paymentIntentId: intent.id,
          assetCode: 'USD',
          assetScale: 2,
          createdAt: new Date(T0),
          debitAmount: 100n,
          receiveAmount: 100n,
          sentAmount: 0n,
          destination: 'REMOTE',
          peerId: 'peer-1'
        }
      ];
      await repo.storeMany([intent]);
      await repo.storeSentPayments([
        { paymentIds: [paymentId], paymentIntent: intent }
      ]);
      if (args.expiresAt) {
        await repo.storeSendingRemotePayments([
          {
            sentPayments: [
              {
                id: paymentId,
                state: args.state,
                ledgerTransferId: 'ledger-1',
                expiresAt: args.expiresAt
              }
            ]
          }
        ]);
      }
      return { paymentIntentId: intent.id, paymentId };
    }

    test('stores and reads back a sending payment expiresAt', async () => {
      const expiresAt = new Date(T0 + 35_000);
      const { paymentIntentId, paymentId } = await storeRemotePayment({
        state: 'SENDING',
        expiresAt
      });

      const [stored] = await repo.fetchByIdsWithPayments([paymentIntentId]);
      const payment = stored.sentPayments.find((p) => p.id === paymentId);
      assert.ok(payment && payment.destination === 'REMOTE');
      assert.equal(payment.expiresAt?.getTime(), expiresAt.getTime());
    });

    test('fetchExpiredPaymentIntentIds returns due CREATED intents, oldest first', async () => {
      const due2 = makeIntentExpiringAt(new Date(NOW.getTime() - 1));
      const due1 = makeIntentExpiringAt(new Date(NOW.getTime() - 2));
      const dueNow = makeIntentExpiringAt(NOW);
      const notDue = makeIntentExpiringAt(new Date(NOW.getTime() + 1));
      const completed = makeIntentExpiringAt(new Date(T0), 'COMPLETED');
      const expired = makeIntentExpiringAt(new Date(T0), 'EXPIRED');
      await repo.storeMany([due2, due1, dueNow, notDue, completed, expired]);

      const result = await repo.fetchExpiredPaymentIntentIds(NOW, 10);

      assert.deepEqual(result, [due1.id, due2.id, dueNow.id]);
    });

    test('fetchExpiredPaymentIntentIds respects the limit', async () => {
      const first = makeIntentExpiringAt(new Date(T0));
      const second = makeIntentExpiringAt(new Date(T0 + 1));
      await repo.storeMany([second, first]);

      assert.deepEqual(await repo.fetchExpiredPaymentIntentIds(NOW, 1), [
        first.id
      ]);
    });

    test('fetchExpiredRemotePayments returns due SENDING payments, oldest first', async () => {
      const due2 = await storeRemotePayment({
        state: 'SENDING',
        expiresAt: new Date(NOW.getTime() - 1)
      });
      const due1 = await storeRemotePayment({
        state: 'SENDING',
        expiresAt: new Date(NOW.getTime() - 2)
      });
      await storeRemotePayment({
        state: 'SENDING',
        expiresAt: new Date(NOW.getTime() + 1)
      });
      await storeRemotePayment({
        state: 'CONFIRMED',
        expiresAt: new Date(T0)
      });
      // Not prepared yet, so no expiresAt.
      await storeRemotePayment({ state: 'PROCESSING' });

      const result = await repo.fetchExpiredRemotePayments(NOW, 10);

      assert.deepEqual(result, [due1, due2]);
    });

    test('fetchExpiredRemotePayments respects the limit', async () => {
      const first = await storeRemotePayment({
        state: 'SENDING',
        expiresAt: new Date(T0)
      });
      await storeRemotePayment({
        state: 'SENDING',
        expiresAt: new Date(T0 + 1)
      });

      assert.deepEqual(await repo.fetchExpiredRemotePayments(NOW, 1), [first]);
    });

    test('storeExpiredPaymentIntents and storeExpiredRemotePayments update state', async () => {
      const intent = makeIntentExpiringAt(new Date(T0));
      await repo.storeMany([intent]);
      const { paymentIntentId, paymentId } = await storeRemotePayment({
        state: 'SENDING',
        expiresAt: new Date(T0)
      });

      await repo.storeExpiredPaymentIntents([
        { id: intent.id, state: 'EXPIRED' }
      ]);
      await repo.storeExpiredRemotePayments([
        {
          sentPayments: [
            { id: paymentId, state: 'EXPIRED', failReason: 'expired' }
          ]
        }
      ]);

      const [storedIntent] = await repo.fetchByIds([intent.id]);
      assert.equal(storedIntent.state, 'EXPIRED');
      const [storedRemote] = await repo.fetchByIdsWithPayments([
        paymentIntentId
      ]);
      const payment = storedRemote.sentPayments[0];
      assert.ok(payment.destination === 'REMOTE');
      assert.equal(payment.state, 'EXPIRED');
      assert.equal(payment.failReason, 'expired');
      assert.deepEqual(await repo.fetchExpiredPaymentIntentIds(NOW, 10), []);
      assert.deepEqual(await repo.fetchExpiredRemotePayments(NOW, 10), []);
    });

    test('init adds the expiry indexes to collections that already exist', async () => {
      await db.collection('paymentIntents').dropIndex('state_1_expiresAt_1');
      await db.collection('sentPayments').dropIndex('state_1_expiresAt_1');

      const second = new MongoDbPaymentIntentRepo(
        `mongodb://${container.getHost()}:${container.getMappedPort(MONGO_PORT)}`,
        new ConsoleLogger()
      );
      await second.init();
      await second.destroy();

      for (const name of ['paymentIntents', 'sentPayments']) {
        const indexes = await db.collection(name).indexes();
        assert.ok(
          indexes.some((index) => index.name === 'state_1_expiresAt_1'),
          `${name} is missing the expiry index`
        );
      }
    });
  });
});
