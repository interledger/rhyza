'use strict';

import { after, before, describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { status } from '@grpc/grpc-js';
import { PaymentsClient, isGrpcServiceError } from '../src';
import { PalClient, parseAddressToDomainAndPathName } from 'pal-client-lib';

function assertGrpcServiceError(err: unknown, expectedCode: status): void {
  assert.ok(isGrpcServiceError(err), 'expected a gRPC ServiceError');
  assert.equal(err.code, expectedCode);
  assert.ok(
    err.details || err.message,
    'expected ServiceError to include a message'
  );
}

describe('Payments Client', () => {
  async function createPaymentIntent(incomingAmount?: number) {
    const id = randomUUID();
    await paymentsClient.createPaymentIntent(
      id,
      receiverWalletAddressId,
      RECEIVER_WALLET_ADDRESS,
      incomingAmount
    );
    return id;
  }

  const PAL_GRPC_URL = process.env['PAL_GRPC_URL'] || '0.0.0.0:50051';
  const PAYMENTS_GRPC_URL = process.env['PAYMENTS_GRPC_URL'] || '0.0.0.0:50052';

  const ASSET_CODE = 'USD';
  const ASSET_SCALE = 2;
  const RECEIVER_WALLET_ADDRESS = 'payments-client-test.com/receiver';
  const PUBLIC_NAME = 'Test Receiver';
  const SENDER_WALLET_ADDRESS = 'payments-client-test.com/sender';
  const SENDER_PUBLIC_NAME = 'Test Sender';

  let palClient: PalClient;
  let paymentsClient: PaymentsClient;
  let receiverWalletAddressId: string;
  let senderWalletAddressId: string;

  before(async () => {
    palClient = new PalClient(PAL_GRPC_URL);
    await palClient.init();

    // Ensure asset exists
    try {
      await palClient.createAsset(ASSET_CODE, ASSET_SCALE);
    } catch {
      // already exists — fine for reruns
    }

    // Ensure wallet address exists
    const { domain: receiverDomain, pathName: receiverPathName } =
      parseAddressToDomainAndPathName(RECEIVER_WALLET_ADDRESS);

    try {
      await palClient.createWalletAddress(
        receiverDomain,
        receiverPathName,
        PUBLIC_NAME,
        ASSET_CODE
      );
    } catch {
      // already exists — fine for reruns
    }

    // Ensure sender wallet address exists
    const { domain: senderDomain, pathName: senderPathName } =
      parseAddressToDomainAndPathName(SENDER_WALLET_ADDRESS);

    try {
      await palClient.createWalletAddress(
        senderDomain,
        senderPathName,
        SENDER_PUBLIC_NAME,
        ASSET_CODE
      );
    } catch {
      // already exists — fine for reruns
    }

    const receiverAlias = await palClient.resolveWalletAddressAlias(
      receiverDomain,
      receiverPathName
    );

    assert.ok(receiverAlias, 'receiver wallet address alias must resolve');

    receiverWalletAddressId = receiverAlias.walletAddressId;

    const senderAlias = await palClient.resolveWalletAddressAlias(
      senderDomain,
      senderPathName
    );

    assert.ok(senderAlias, 'sender wallet address alias must resolve');

    senderWalletAddressId = senderAlias.walletAddressId;

    paymentsClient = new PaymentsClient(PAYMENTS_GRPC_URL);
    await paymentsClient.init();
  });

  after(async () => {
    await paymentsClient.disconnect();
    await palClient.disconnect();
  });

  test('create payment intent (required fields only)', async () => {
    const id = randomUUID();
    const result = await paymentsClient.createPaymentIntent(
      id,
      receiverWalletAddressId,
      RECEIVER_WALLET_ADDRESS
    );

    assert.equal(result.id, id);
    assert.equal(result.receiverWalletAddress, RECEIVER_WALLET_ADDRESS);
    assert.equal(result.state, 'CREATED');
    assert.equal(result.destination, 'LOCAL');
    assert.equal(result.receivedAmount, 0n);
    assert.equal(result.assetCode, ASSET_CODE);
    assert.equal(result.assetScale, ASSET_SCALE);
    assert.equal(result.incomingAmount, undefined);
    assert.ok(result.expiresAt);
    assert.ok(!Number.isNaN(Date.parse(result.expiresAt!)));
    assert.ok(result.createdAt);
    assert.ok(!Number.isNaN(Date.parse(result.createdAt)));
  });

  test('create payment intent (all fields)', async () => {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 5).toISOString(); // 5 minutes
    const metadata = JSON.stringify({
      description: 'test'
    });
    const result = await paymentsClient.createPaymentIntent(
      id,
      receiverWalletAddressId,
      RECEIVER_WALLET_ADDRESS,
      100,
      expiresAt,
      metadata
    );

    assert.equal(result.id, id);
    assert.equal(result.receiverWalletAddress, RECEIVER_WALLET_ADDRESS);
    assert.equal(result.state, 'CREATED');
    assert.equal(result.destination, 'LOCAL');
    assert.equal(result.receivedAmount, 0n);
    assert.equal(result.assetCode, ASSET_CODE);
    assert.equal(result.assetScale, ASSET_SCALE);
    assert.equal(result.incomingAmount, 100n);
    assert.ok(result.expiresAt);
    assert.equal(
      new Date(result.expiresAt!).getTime(),
      new Date(expiresAt).getTime()
    );
    assert.ok(result.createdAt);
    assert.ok(!Number.isNaN(Date.parse(result.createdAt)));
  });

  test('duplicate id is rejected', async () => {
    const id = randomUUID();
    await paymentsClient.createPaymentIntent(
      id,
      receiverWalletAddressId,
      RECEIVER_WALLET_ADDRESS
    );

    try {
      await paymentsClient.createPaymentIntent(
        id,
        receiverWalletAddressId,
        RECEIVER_WALLET_ADDRESS
      );
      assert.fail('expected error for duplicate id');
    } catch (e) {
      assertGrpcServiceError(e, status.ALREADY_EXISTS);
    }
  });

  test('invalid uuid is rejected immediately', async () => {
    try {
      await paymentsClient.createPaymentIntent(
        'not-a-uuid',
        receiverWalletAddressId,
        RECEIVER_WALLET_ADDRESS
      );
      assert.fail('expected error for invalid uuid');
    } catch (e) {
      assertGrpcServiceError(e, status.INVALID_ARGUMENT);
    }
  });

  test('unknown wallet address id is rejected', async () => {
    try {
      await paymentsClient.createPaymentIntent(
        randomUUID(),
        randomUUID(), // nonexistent wallet address id
        RECEIVER_WALLET_ADDRESS
      );
      assert.fail('expected error for unknown wallet address');
    } catch (e) {
      assertGrpcServiceError(e, status.NOT_FOUND);
    }
  });

  describe('getPaymentIntent', () => {
    test('returns payment intent', async () => {
      const id = await createPaymentIntent(100);
      const result = await paymentsClient.getPaymentIntent(id);

      assert.equal(result.id, id);
      assert.equal(result.incomingAmount, 100n);
    });

    test('unknown id returns NOT_FOUND ServiceError', async () => {
      try {
        await paymentsClient.getPaymentIntent(randomUUID());
        assert.fail('expected NOT_FOUND ServiceError');
      } catch (e) {
        assertGrpcServiceError(e, status.NOT_FOUND);
      }
    });
  });

  describe('getQuote', () => {
    test('returns completed quote', async () => {
      const paymentIntentId = await createPaymentIntent(100);
      const quoteId = randomUUID();
      const created = await paymentsClient.createQuote(
        quoteId,
        { incomingPaymentId: paymentIntentId },
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS
      );

      const result = await paymentsClient.getQuote(paymentIntentId, quoteId);

      assert.equal(result.id, quoteId);
      assert.equal(result.paymentIntentId, paymentIntentId);
      assert.equal(result.state, 'COMPLETED');
      assert.equal(result.senderWalletAddress, SENDER_WALLET_ADDRESS);
      assert.equal(result.senderWalletAddressId, senderWalletAddressId);
      assert.equal(result.debitAmount, created.debitAmount);
      assert.equal(result.receiveAmount, created.receiveAmount);
      assert.equal(result.exchangeRate, created.exchangeRate);
      assert.equal(result.expiresAt, created.expiresAt);
      assert.ok(created.createdAt);
      assert.ok(!Number.isNaN(Date.parse(created.createdAt)));
      assert.equal(result.createdAt, created.createdAt);
      assert.ok(result.createdAt);
      assert.ok(!Number.isNaN(Date.parse(result.createdAt)));
      assert.equal(result.errorName, undefined);
      assert.equal(result.message, undefined);
    });

    test('unknown payment intent id returns NOT_FOUND ServiceError', async () => {
      try {
        await paymentsClient.getQuote(randomUUID(), randomUUID());
        assert.fail('expected NOT_FOUND ServiceError');
      } catch (e) {
        assertGrpcServiceError(e, status.NOT_FOUND);
      }
    });

    test('unknown quote id on an existing payment intent returns NOT_FOUND ServiceError', async () => {
      const paymentIntentId = await createPaymentIntent(100);

      try {
        await paymentsClient.getQuote(paymentIntentId, randomUUID());
        assert.fail('expected NOT_FOUND ServiceError');
      } catch (e) {
        assertGrpcServiceError(e, status.NOT_FOUND);
      }
    });

    test('quote id on a different payment intent returns NOT_FOUND ServiceError', async () => {
      const paymentIntentId = await createPaymentIntent(100);
      const otherPaymentIntentId = await createPaymentIntent(100);
      const quoteId = randomUUID();
      await paymentsClient.createQuote(
        quoteId,
        { incomingPaymentId: paymentIntentId },
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS
      );

      try {
        await paymentsClient.getQuote(otherPaymentIntentId, quoteId);
        assert.fail('expected NOT_FOUND ServiceError');
      } catch (e) {
        assertGrpcServiceError(e, status.NOT_FOUND);
      }
    });
  });

  describe('completePaymentIntent', () => {
    test('invalid uuid returns INVALID_ARGUMENT ServiceError', async () => {
      try {
        await paymentsClient.completePaymentIntent('not-a-uuid');
        assert.fail('expected INVALID_ARGUMENT ServiceError');
      } catch (e) {
        assertGrpcServiceError(e, status.INVALID_ARGUMENT);
      }
    });

    test('unknown id returns NOT_FOUND ServiceError', async () => {
      try {
        await paymentsClient.completePaymentIntent(randomUUID());
        assert.fail('expected NOT_FOUND ServiceError');
      } catch (e) {
        assertGrpcServiceError(e, status.NOT_FOUND);
      }
    });

    test('completes a CREATED local intent', async () => {
      const id = randomUUID();
      const incomingAmount = 100;
      const expiresAt = new Date(Date.now() + 1000 * 60 * 5).toISOString();
      await paymentsClient.createPaymentIntent(
        id,
        receiverWalletAddressId,
        RECEIVER_WALLET_ADDRESS,
        incomingAmount,
        expiresAt
      );

      const result = await paymentsClient.completePaymentIntent(id);

      assert.equal(result.id, id);
      assert.equal(result.state, 'COMPLETED');
      assert.equal(result.receiverWalletAddress, RECEIVER_WALLET_ADDRESS);
      assert.equal(result.destination, 'LOCAL');
      assert.equal(result.receivedAmount, 0n);
      assert.equal(result.assetCode, ASSET_CODE);
      assert.equal(result.assetScale, ASSET_SCALE);
      assert.equal(result.incomingAmount, BigInt(incomingAmount));
      assert.ok(result.expiresAt);
      assert.equal(
        new Date(result.expiresAt!).getTime(),
        new Date(expiresAt).getTime()
      );
    });

    test('completing an already COMPLETED intent returns FAILED_PRECONDITION ServiceError', async () => {
      const id = await createPaymentIntent();
      await paymentsClient.completePaymentIntent(id);

      try {
        await paymentsClient.completePaymentIntent(id);
        assert.fail('expected FAILED_PRECONDITION ServiceError');
      } catch (e) {
        assertGrpcServiceError(e, status.FAILED_PRECONDITION);
      }
    });
  });

  describe('createQuote', () => {
    test('create quote with debitAmount', async () => {
      const paymentIntentId = await createPaymentIntent();
      const quoteId = randomUUID();
      const result = await paymentsClient.createQuote(
        quoteId,
        { incomingPaymentId: paymentIntentId },
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS,
        100
      );

      assert.ok(result);
      assert.equal(result.id, quoteId);
      assert.ok(result.createdAt);
      assert.ok(!Number.isNaN(Date.parse(result.createdAt)));
    });

    test('create quote with receiveAmount', async () => {
      const paymentIntentId = await createPaymentIntent();
      const quoteId = randomUUID();
      const result = await paymentsClient.createQuote(
        quoteId,
        { incomingPaymentId: paymentIntentId },
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS,
        undefined,
        100
      );

      assert.ok(result);
      assert.equal(result.id, quoteId);
      assert.ok(result.createdAt);
      assert.ok(!Number.isNaN(Date.parse(result.createdAt)));
    });

    test('create quote using incomingAmount', async () => {
      const paymentIntentId = await createPaymentIntent(100);
      const quoteId = randomUUID();
      const result = await paymentsClient.createQuote(
        quoteId,
        { incomingPaymentId: paymentIntentId },
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS
      );

      assert.ok(result);
      assert.equal(result.id, quoteId);
      assert.ok(result.createdAt);
      assert.ok(!Number.isNaN(Date.parse(result.createdAt)));
    });

    test('duplicate quote id is rejected', async () => {
      const paymentIntentId = await createPaymentIntent();
      const quoteId = randomUUID();
      await paymentsClient.createQuote(
        quoteId,
        { incomingPaymentId: paymentIntentId },
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS,
        100
      );

      try {
        await paymentsClient.createQuote(
          quoteId,
          { incomingPaymentId: paymentIntentId },
          senderWalletAddressId,
          SENDER_WALLET_ADDRESS,
          100
        );
        assert.fail('expected error for duplicate quote id');
      } catch (e) {
        assertGrpcServiceError(e, status.NOT_FOUND);
      }
    });

    test('unknown payment intent id is rejected', async () => {
      try {
        await paymentsClient.createQuote(
          randomUUID(),
          { incomingPaymentId: randomUUID() },
          senderWalletAddressId,
          SENDER_WALLET_ADDRESS,
          100
        );
        assert.fail('expected error for unknown incoming payment');
      } catch (e) {
        assertGrpcServiceError(e, status.NOT_FOUND);
      }
    });

    test('remote quote without openPaymentsUrl throws FAILED_PRECONDITION ServiceError', async () => {
      const clientWithoutUrl = new PaymentsClient(PAYMENTS_GRPC_URL);
      await clientWithoutUrl.init();
      try {
        await clientWithoutUrl.createQuote(
          randomUUID(),
          {
            incomingPaymentUrl:
              'https://remote.example.com/incoming-payments/123'
          },
          senderWalletAddressId,
          SENDER_WALLET_ADDRESS
        );
        assert.fail('expected FAILED_PRECONDITION ServiceError');
      } catch (e) {
        assert.ok(isGrpcServiceError(e));
        assert.equal(e.code, status.FAILED_PRECONDITION);
        assert.equal(e.name, 'RemoteQuotingNotConfigured');
      } finally {
        await clientWithoutUrl.disconnect();
      }
    });

    test('unknown sender wallet address id is rejected', async () => {
      const paymentIntentId = await createPaymentIntent();
      try {
        await paymentsClient.createQuote(
          randomUUID(),
          { incomingPaymentId: paymentIntentId },
          randomUUID(),
          SENDER_WALLET_ADDRESS,
          100
        );
        assert.fail('expected error for unknown wallet address');
      } catch (e) {
        assertGrpcServiceError(e, status.NOT_FOUND);
      }
    });
  });

  describe('createPayment', () => {
    test('create payment with quoteId', async () => {
      const paymentIntentId = await createPaymentIntent(100);
      const quoteId = randomUUID();
      await paymentsClient.createQuote(
        quoteId,
        { incomingPaymentId: paymentIntentId },
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS
      );

      const paymentId = randomUUID();
      const result = await paymentsClient.createPayment(
        paymentId,
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS,
        paymentIntentId,
        quoteId
      );

      assert.ok(result);
      assert.equal(result.id, paymentId);
    });

    test('create payment with debitAmount', async () => {
      const paymentIntentId = await createPaymentIntent(100);
      const paymentId = randomUUID();
      const result = await paymentsClient.createPayment(
        paymentId,
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS,
        paymentIntentId,
        undefined,
        100
      );

      assert.ok(result);
      assert.equal(result.id, paymentId);
    });

    test('create payment with grantId', async () => {
      const paymentIntentId = await createPaymentIntent(100);
      const paymentId = randomUUID();
      const result = await paymentsClient.createPayment(
        paymentId,
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS,
        paymentIntentId,
        undefined,
        100,
        'grant-1'
      );

      assert.equal(result.id, paymentId);
    });

    test('duplicate id is rejected', async () => {
      const paymentIntentId = await createPaymentIntent(100);
      const paymentId = randomUUID();
      await paymentsClient.createPayment(
        paymentId,
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS,
        paymentIntentId,
        undefined,
        100
      );

      try {
        await paymentsClient.createPayment(
          paymentId,
          senderWalletAddressId,
          SENDER_WALLET_ADDRESS,
          paymentIntentId,
          undefined,
          100
        );
        assert.fail('expected error for duplicate id');
      } catch (e) {
        assertGrpcServiceError(e, status.INVALID_ARGUMENT);
      }
    });

    test('unknown payment intent id is rejected', async () => {
      try {
        await paymentsClient.createPayment(
          randomUUID(),
          senderWalletAddressId,
          SENDER_WALLET_ADDRESS,
          randomUUID(),
          undefined,
          100
        );
        assert.fail('expected error for unknown incoming payment');
      } catch (e) {
        assertGrpcServiceError(e, status.NOT_FOUND);
      }
    });

    test('unknown wallet address id is rejected', async () => {
      const paymentIntentId = await createPaymentIntent(100);
      try {
        await paymentsClient.createPayment(
          randomUUID(),
          randomUUID(),
          SENDER_WALLET_ADDRESS,
          paymentIntentId,
          undefined,
          100
        );
        assert.fail('expected error for unknown wallet address');
      } catch (e) {
        assertGrpcServiceError(e, status.NOT_FOUND);
      }
    });
  });

  describe('approvePayment', () => {
    test('approve payment', async () => {
      const paymentIntentId = await createPaymentIntent(100);
      const paymentId = randomUUID();
      await paymentsClient.createPayment(
        paymentId,
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS,
        paymentIntentId,
        undefined,
        100
      );

      const result = await paymentsClient.approvePayment(
        paymentIntentId,
        paymentId
      );

      assert.ok(result);
      assert.equal(result.id, paymentId);
    });

    test('duplicate approval is rejected', async () => {
      const paymentIntentId = await createPaymentIntent(100);
      const paymentId = randomUUID();
      await paymentsClient.createPayment(
        paymentId,
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS,
        paymentIntentId,
        undefined,
        100
      );

      await paymentsClient.approvePayment(paymentIntentId, paymentId);

      try {
        await paymentsClient.approvePayment(paymentIntentId, paymentId);
        assert.fail('expected error for duplicate approval');
      } catch (e) {
        assertGrpcServiceError(e, status.FAILED_PRECONDITION);
      }
    });

    test('unknown payment id is rejected', async () => {
      const paymentIntentId = await createPaymentIntent(100);
      try {
        await paymentsClient.approvePayment(paymentIntentId, randomUUID());
        assert.fail('expected error for unknown payment');
      } catch (e) {
        assertGrpcServiceError(e, status.NOT_FOUND);
      }
    });

    test('unknown payment intent id is rejected', async () => {
      const paymentIntentId = await createPaymentIntent(100);
      const paymentId = randomUUID();
      await paymentsClient.createPayment(
        paymentId,
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS,
        paymentIntentId,
        undefined,
        100
      );

      try {
        await paymentsClient.approvePayment(randomUUID(), paymentId);
        assert.fail('expected error for unknown payment intent');
      } catch (e) {
        assertGrpcServiceError(e, status.NOT_FOUND);
      }
    });
  });

  describe('getPaymentIntentsPage', () => {
    // Fresh wallet address per test run so pagination assertions are
    // isolated from data left behind by earlier runs.
    const PAGE_RECEIVER_ADDRESS = `payments-client-test.com/page-receiver-${randomUUID()}`;
    let pageReceiverWalletAddressId: string;
    const intentIds: string[] = [];

    before(async () => {
      const { domain, pathName } = parseAddressToDomainAndPathName(
        PAGE_RECEIVER_ADDRESS
      );
      await palClient.createWalletAddress(
        domain,
        pathName,
        'Page Receiver',
        ASSET_CODE
      );
      const alias = await palClient.resolveWalletAddressAlias(domain, pathName);
      assert.ok(alias, 'page receiver wallet address alias must resolve');
      pageReceiverWalletAddressId = alias.walletAddressId;

      for (let i = 0; i < 5; i++) {
        const id = randomUUID();
        await paymentsClient.createPaymentIntent(
          id,
          pageReceiverWalletAddressId,
          PAGE_RECEIVER_ADDRESS,
          100
        );
        intentIds.push(id);
      }
    });

    test('walks forward through all intents without gaps or duplicates', async () => {
      const page1 = await paymentsClient.getPaymentIntentsPage({
        walletAddressId: pageReceiverWalletAddressId,
        first: 2
      });
      assert.equal(page1.items.length, 2);
      assert.equal(page1.pagination.hasNextPage, true);
      assert.equal(page1.pagination.hasPreviousPage, false);
      assert.ok(page1.pagination.startCursor);
      assert.ok(page1.pagination.endCursor);
      assert.notEqual(page1.pagination.startCursor, page1.items[0].id);

      const page2 = await paymentsClient.getPaymentIntentsPage({
        walletAddressId: pageReceiverWalletAddressId,
        first: 2,
        cursor: page1.pagination.endCursor
      });
      assert.equal(page2.items.length, 2);
      assert.equal(page2.pagination.hasNextPage, true);
      assert.equal(page2.pagination.hasPreviousPage, true);

      const page3 = await paymentsClient.getPaymentIntentsPage({
        walletAddressId: pageReceiverWalletAddressId,
        first: 2,
        cursor: page2.pagination.endCursor
      });
      assert.equal(page3.items.length, 1);
      assert.equal(page3.pagination.hasNextPage, false);
      assert.equal(page3.pagination.hasPreviousPage, true);

      const walked = [...page1.items, ...page2.items, ...page3.items];
      assert.equal(walked.length, 5);
      assert.deepEqual(
        new Set(walked.map((intent) => intent.id)),
        new Set(intentIds)
      );
      for (const intent of walked) {
        assert.ok(intent.createdAt, 'expected createdAt on page items');
      }
    });

    test('walks backward with last + cursor', async () => {
      const forward = await paymentsClient.getPaymentIntentsPage({
        walletAddressId: pageReceiverWalletAddressId,
        first: 5
      });
      assert.equal(forward.items.length, 5);

      const backward = await paymentsClient.getPaymentIntentsPage({
        walletAddressId: pageReceiverWalletAddressId,
        last: 2,
        cursor: forward.pagination.endCursor
      });
      assert.equal(backward.items.length, 2);
      // the two items immediately before the boundary, still ascending
      assert.deepEqual(
        backward.items.map((intent) => intent.id),
        forward.items.slice(2, 4).map((intent) => intent.id)
      );
      assert.equal(backward.pagination.hasNextPage, true);
      assert.equal(backward.pagination.hasPreviousPage, true);
    });

    test('first and last together are rejected', async () => {
      try {
        await paymentsClient.getPaymentIntentsPage({
          first: 1,
          last: 1,
          cursor: intentIds[0]
        });
        assert.fail('expected INVALID_ARGUMENT ServiceError');
      } catch (e) {
        assertGrpcServiceError(e, status.INVALID_ARGUMENT);
      }
    });

    test('last without cursor is rejected', async () => {
      try {
        await paymentsClient.getPaymentIntentsPage({ last: 1 });
        assert.fail('expected INVALID_ARGUMENT ServiceError');
      } catch (e) {
        assertGrpcServiceError(e, status.INVALID_ARGUMENT);
      }
    });

    test('unknown cursor is rejected', async () => {
      try {
        await paymentsClient.getPaymentIntentsPage({
          walletAddressId: pageReceiverWalletAddressId,
          cursor: randomUUID(),
          first: 2
        });
        assert.fail('expected INVALID_ARGUMENT ServiceError');
      } catch (e) {
        assertGrpcServiceError(e, status.INVALID_ARGUMENT);
      }
    });

    test('filtering by an unknown wallet address returns an empty page', async () => {
      const page = await paymentsClient.getPaymentIntentsPage({
        walletAddressId: randomUUID(),
        first: 10
      });
      assert.equal(page.items.length, 0);
      assert.equal(page.pagination.hasNextPage, false);
      assert.equal(page.pagination.hasPreviousPage, false);
      assert.equal(page.pagination.startCursor, undefined);
      assert.equal(page.pagination.endCursor, undefined);
    });
  });

  describe('getPaymentsPage', () => {
    // Fresh sender wallet address per test run isolates these payments.
    const PAGE_SENDER_ADDRESS = `payments-client-test.com/page-sender-${randomUUID()}`;
    let pageSenderWalletAddressId: string;
    const paymentIds: string[] = [];
    let firstIntentId: string;

    before(async () => {
      const { domain, pathName } =
        parseAddressToDomainAndPathName(PAGE_SENDER_ADDRESS);
      await palClient.createWalletAddress(
        domain,
        pathName,
        'Page Sender',
        ASSET_CODE
      );
      const alias = await palClient.resolveWalletAddressAlias(domain, pathName);
      assert.ok(alias, 'page sender wallet address alias must resolve');
      pageSenderWalletAddressId = alias.walletAddressId;

      // three payments across two intents
      firstIntentId = await createPaymentIntent(100);
      const secondIntentId = await createPaymentIntent(100);
      for (const intentId of [firstIntentId, firstIntentId, secondIntentId]) {
        const paymentId = randomUUID();
        await paymentsClient.createPayment(
          paymentId,
          pageSenderWalletAddressId,
          PAGE_SENDER_ADDRESS,
          intentId,
          undefined,
          100
        );
        paymentIds.push(paymentId);
      }
    });

    test('walks forward through all payments with hydrated amounts', async () => {
      const page1 = await paymentsClient.getPaymentsPage({
        walletAddressId: pageSenderWalletAddressId,
        first: 2
      });
      assert.equal(page1.items.length, 2);
      assert.equal(page1.pagination.hasNextPage, true);
      assert.equal(page1.pagination.hasPreviousPage, false);

      const page2 = await paymentsClient.getPaymentsPage({
        walletAddressId: pageSenderWalletAddressId,
        first: 2,
        cursor: page1.pagination.endCursor
      });
      assert.equal(page2.items.length, 1);
      assert.equal(page2.pagination.hasNextPage, false);
      assert.equal(page2.pagination.hasPreviousPage, true);

      const walked = [...page1.items, ...page2.items];
      assert.deepEqual(
        new Set(walked.map((payment) => payment.id)),
        new Set(paymentIds)
      );

      for (const payment of walked) {
        assert.equal(payment.senderWalletAddressId, pageSenderWalletAddressId);
        assert.ok(payment.createdAt, 'expected createdAt on page items');
        // debit/sent amounts in the sender-side asset
        assert.deepEqual(payment.debitAmount, {
          value: 100n,
          assetCode: ASSET_CODE,
          assetScale: ASSET_SCALE
        });
        assert.equal(payment.sentAmount.value, 0n);
        assert.equal(payment.sentAmount.assetCode, ASSET_CODE);
        // receiveAmount hydrated with the parent intent's (receive-side) asset
        assert.equal(payment.receiveAmount.assetCode, ASSET_CODE);
        assert.equal(payment.receiveAmount.assetScale, ASSET_SCALE);
        // LOCAL parent intents have no remoteUrl
        assert.equal(payment.remoteUrl, undefined);
      }
    });

    test('filters by paymentIntentId', async () => {
      const page = await paymentsClient.getPaymentsPage({
        walletAddressId: pageSenderWalletAddressId,
        paymentIntentId: firstIntentId,
        first: 10
      });
      assert.equal(page.items.length, 2);
      for (const payment of page.items) {
        assert.equal(payment.paymentIntentId, firstIntentId);
      }
    });
  });
});
