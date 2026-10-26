'use strict';

/**
 * Two command-handler instances adding a quote to the SAME payment intent.
 *
 * This test FAILS on this branch and PASSES on main, with no change to the
 * test itself. The only difference is the write `storeQuotes` issues:
 *
 *   main:        $push of just the new quote -> additive, both quotes survive
 *   this branch: $set of the whole array     -> last writer wins, one is lost
 *
 * Why two instances can touch one intent at once: commands are Kafka-keyed by
 * `payload.paymentIntentId` (payments-domain-lib/src/commands.ts), but a quote
 * against a REMOTE intent is addressed by URL — the caller cannot know the
 * local intent id, so payments-client-lib/src/client.ts mints a fresh
 * `randomUUID()` per request. Two quote requests for one remote URL therefore
 * carry unrelated keys, land on different partitions, and can be handled
 * concurrently by different instances. Both aggregates resolve the URL to the
 * same intent via `fetchIdsByRemoteUrls` (and skip the remote fetch, since the
 * intent is already local), both read it, both mutate their own copy, both
 * flush. That is the interleaving below.
 */

import { after, before, describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { MongoClient } from 'mongodb';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { NullLogger } from 'common-types-lib';
import { IPaymentIntent, IQuote } from 'payments-domain-lib';
import { MongoDbPaymentIntentRepo } from '../src';

const MONGO_IMAGE = 'mongo:8';
const MONGO_PORT = 27017;

describe('storeQuotes concurrency', () => {
  let container: StartedTestContainer;
  let client: MongoClient;
  let repo: MongoDbPaymentIntentRepo;

  before(async () => {
    container = await new GenericContainer(MONGO_IMAGE)
      .withExposedPorts(MONGO_PORT)
      .start();
    const url = `mongodb://${container.getHost()}:${container.getMappedPort(MONGO_PORT)}`;
    client = new MongoClient(url);
    await client.connect();
    repo = new MongoDbPaymentIntentRepo(url, new NullLogger());
    await repo.init();
  });

  after(async () => {
    await Promise.allSettled([
      repo?.destroy(),
      client?.close(),
      container?.stop()
    ]);
  });

  const makeRemoteIntent = (): IPaymentIntent => ({
    id: randomUUID(),
    receiverWalletAddress: 'remote.example.com/alice',
    state: 'CREATED',
    destination: 'REMOTE',
    assetCode: 'USD',
    assetScale: 2,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    incomingAmount: null,
    receivedAmount: 0n,
    quotes: [],
    sentPayments: [],
    inboundPayments: [],
    destinationIlpAddress: 'g.peer.123',
    remoteUrl: `https://remote.example.com/incoming-payments/${randomUUID()}`
  });

  const makePendingQuote = (): IQuote => ({
    id: randomUUID(),
    state: 'PENDING',
    senderWalletAddress: 'local.example.com/bob',
    senderWalletAddressId: randomUUID(),
    createdAt: new Date(),
    route: {
      peerId: 'peer-1',
      peerAssetCode: 'USD',
      peerAssetScale: 2,
      sourceAmount: 100n,
      senderAssetCode: 'USD'
    }
  });

  test('two instances quoting one intent each keep their quote', async () => {
    const intent = makeRemoteIntent();
    await repo.storeMany([intent]);

    // Each instance reads the intent at the start of its own batch.
    const [readA] = await repo.fetchByIdsWithPayments([intent.id]);
    const [readB] = await repo.fetchByIdsWithPayments([intent.id]);

    // Each adds its own pending quote to its own copy
    // (aggregate: paymentIntent.addPendingRemoteQuote(...)).
    const quoteA = makePendingQuote();
    const quoteB = makePendingQuote();
    readA.quotes.push(quoteA);
    readB.quotes.push(quoteB);

    // Each flushes, neither aware of the other's quote.
    await repo.storeQuotes([readA]);
    await repo.storeQuotes([readB]);

    const [stored] = await repo.fetchByIdsWithPayments([intent.id]);
    assert.deepEqual(
      stored.quotes.map((q) => q.id).sort(),
      [quoteA.id, quoteB.id].sort(),
      'a quote was lost: the second $set overwrote the array the first wrote'
    );
  });
});
