'use strict';

import { after, before, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { Db, MongoClient } from 'mongodb';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { ConsoleLogger } from 'common-types-lib';
import { IPaymentIntent, ISentPayment } from 'payments-domain-lib';
import { MongoDbPaymentIntentRepo } from '../../src';

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
});
