'use strict';

import { after, before, describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { PaymentsClient, RemoteQuotingNotConfiguredError } from '../src';
import { PalClient, parseAddressToDomainAndPathName } from 'pal-client-lib';

describe('Payments Client', () => {
  async function createIncomingPayment(incomingAmount?: number) {
    const id = randomUUID();
    await paymentsClient.createIncomingPayment(
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
      await palClient.createAsset(
        ASSET_CODE,
        ASSET_SCALE,
        undefined,
        undefined
      );
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
      parseAddressToDomainAndPathName(RECEIVER_WALLET_ADDRESS);

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

    const receiverAlias = await palClient.ResolveWalletAddressAlias(
      receiverDomain,
      receiverPathName
    );

    assert.ok(receiverAlias, 'receiver wallet address alias must resolve');

    receiverWalletAddressId = receiverAlias.walletAddressId;

    const senderAlias = await palClient.ResolveWalletAddressAlias(
      receiverDomain,
      receiverPathName
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

  test('create incoming payment (required fields only)', async () => {
    const id = randomUUID();
    const result = await paymentsClient.createIncomingPayment(
      id,
      receiverWalletAddressId,
      RECEIVER_WALLET_ADDRESS
    );

    assert.ok(result);
    assert.equal(result.id, id);
  });

  test('create incoming payment (all fields)', async () => {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 5).toISOString(); // 5 minutes
    const result = await paymentsClient.createIncomingPayment(
      id,
      receiverWalletAddressId,
      RECEIVER_WALLET_ADDRESS,
      100,
      expiresAt
    );

    assert.ok(result);
    assert.equal(result.id, id);
  });

  test('duplicate id is rejected', async () => {
    const id = randomUUID();
    await paymentsClient.createIncomingPayment(
      id,
      receiverWalletAddressId,
      RECEIVER_WALLET_ADDRESS
    );

    try {
      await paymentsClient.createIncomingPayment(
        id,
        receiverWalletAddressId,
        RECEIVER_WALLET_ADDRESS
      );
      assert.fail('expected error for duplicate id');
    } catch (e) {
      assert.ok(e instanceof Error);
    }
  });

  test('invalid uuid is rejected immediately', async () => {
    try {
      await paymentsClient.createIncomingPayment(
        'not-a-uuid',
        receiverWalletAddressId,
        RECEIVER_WALLET_ADDRESS
      );
      assert.fail('expected error for invalid uuid');
    } catch (e) {
      assert.ok(e instanceof Error);
    }
  });

  test('unknown wallet address id is rejected', async () => {
    try {
      await paymentsClient.createIncomingPayment(
        randomUUID(),
        randomUUID(), // nonexistent wallet address id
        RECEIVER_WALLET_ADDRESS
      );
      assert.fail('expected error for unknown wallet address');
    } catch (e) {
      assert.ok(e instanceof Error);
    }
  });

  describe('createQuote', () => {
    test('create quote with debitAmount', async () => {
      const paymentId = await createIncomingPayment();
      const quoteId = randomUUID();
      const result = await paymentsClient.createQuote(
        quoteId,
        { incomingPaymentId: paymentId },
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS,
        100
      );

      assert.ok(result);
      assert.equal(result.id, quoteId);
    });

    test('create quote with receiveAmount', async () => {
      const paymentId = await createIncomingPayment();
      const quoteId = randomUUID();
      const result = await paymentsClient.createQuote(
        quoteId,
        { incomingPaymentId: paymentId },
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS,
        undefined,
        100
      );

      assert.ok(result);
      assert.equal(result.id, quoteId);
    });

    test('create quote using incomingAmount', async () => {
      const paymentId = await createIncomingPayment(100);
      const quoteId = randomUUID();
      const result = await paymentsClient.createQuote(
        quoteId,
        { incomingPaymentId: paymentId },
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS
      );

      assert.ok(result);
      assert.equal(result.id, quoteId);
    });

    test('duplicate quote id is rejected', async () => {
      const paymentId = await createIncomingPayment();
      const quoteId = randomUUID();
      await paymentsClient.createQuote(
        quoteId,
        { incomingPaymentId: paymentId },
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS,
        100
      );

      try {
        await paymentsClient.createQuote(
          quoteId,
          { incomingPaymentId: paymentId },
          senderWalletAddressId,
          SENDER_WALLET_ADDRESS,
          100
        );
        assert.fail('expected error for duplicate quote id');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });

    test('unknown incoming payment id is rejected', async () => {
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
        assert.ok(e instanceof Error);
      }
    });

    test('remote quote without openPaymentsUrl throws RemoteQuotingNotConfiguredError', async () => {
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
        assert.fail('expected RemoteQuotingNotConfiguredError');
      } catch (e) {
        assert.ok(e instanceof RemoteQuotingNotConfiguredError);
      } finally {
        await clientWithoutUrl.disconnect();
      }
    });

    test('unknown sender wallet address id is rejected', async () => {
      const paymentId = await createIncomingPayment();
      try {
        await paymentsClient.createQuote(
          randomUUID(),
          { incomingPaymentId: paymentId },
          randomUUID(),
          SENDER_WALLET_ADDRESS,
          100
        );
        assert.fail('expected error for unknown wallet address');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });
  });

  describe('createOutgoingPayment', () => {
    test('create outgoing payment with quoteId', async () => {
      const incomingPaymentId = await createIncomingPayment(100);
      const quoteId = randomUUID();
      await paymentsClient.createQuote(
        quoteId,
        { incomingPaymentId },
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS
      );

      const outgoingPaymentId = randomUUID();
      const result = await paymentsClient.createOutgoingPayment(
        outgoingPaymentId,
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS,
        incomingPaymentId,
        quoteId
      );

      assert.ok(result);
      assert.equal(result.id, outgoingPaymentId);
    });

    test('create outgoing payment with debitAmount', async () => {
      const incomingPaymentId = await createIncomingPayment(100);
      const outgoingPaymentId = randomUUID();
      const result = await paymentsClient.createOutgoingPayment(
        outgoingPaymentId,
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS,
        incomingPaymentId,
        undefined,
        100
      );

      assert.ok(result);
      assert.equal(result.id, outgoingPaymentId);
    });

    test('duplicate id is rejected', async () => {
      const incomingPaymentId = await createIncomingPayment(100);
      const outgoingPaymentId = randomUUID();
      await paymentsClient.createOutgoingPayment(
        outgoingPaymentId,
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS,
        incomingPaymentId,
        undefined,
        100
      );

      try {
        await paymentsClient.createOutgoingPayment(
          outgoingPaymentId,
          senderWalletAddressId,
          SENDER_WALLET_ADDRESS,
          incomingPaymentId,
          undefined,
          100
        );
        assert.fail('expected error for duplicate id');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });

    test('unknown incoming payment id is rejected', async () => {
      try {
        await paymentsClient.createOutgoingPayment(
          randomUUID(),
          senderWalletAddressId,
          SENDER_WALLET_ADDRESS,
          randomUUID(),
          undefined,
          100
        );
        assert.fail('expected error for unknown incoming payment');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });

    test('unknown wallet address id is rejected', async () => {
      const incomingPaymentId = await createIncomingPayment(100);
      try {
        await paymentsClient.createOutgoingPayment(
          randomUUID(),
          randomUUID(),
          SENDER_WALLET_ADDRESS,
          incomingPaymentId,
          undefined,
          100
        );
        assert.fail('expected error for unknown wallet address');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });
  });

  describe('approveOutgoingPayment', () => {
    test('approve outgoing payment', async () => {
      const incomingPaymentId = await createIncomingPayment(100);
      const outgoingPaymentId = randomUUID();
      await paymentsClient.createOutgoingPayment(
        outgoingPaymentId,
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS,
        incomingPaymentId,
        undefined,
        100
      );

      const result = await paymentsClient.approveOutgoingPayment(
        outgoingPaymentId,
        incomingPaymentId
      );

      assert.ok(result);
      assert.equal(result.id, outgoingPaymentId);
    });

    test('duplicate approval is rejected', async () => {
      const incomingPaymentId = await createIncomingPayment(100);
      const outgoingPaymentId = randomUUID();
      await paymentsClient.createOutgoingPayment(
        outgoingPaymentId,
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS,
        incomingPaymentId,
        undefined,
        100
      );

      await paymentsClient.approveOutgoingPayment(
        outgoingPaymentId,
        incomingPaymentId
      );

      try {
        await paymentsClient.approveOutgoingPayment(
          outgoingPaymentId,
          incomingPaymentId
        );
        assert.fail('expected error for duplicate approval');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });

    test('unknown outgoing payment id is rejected', async () => {
      const incomingPaymentId = await createIncomingPayment(100);
      try {
        await paymentsClient.approveOutgoingPayment(
          randomUUID(),
          incomingPaymentId
        );
        assert.fail('expected error for unknown outgoing payment');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });

    test('unknown incoming payment id is rejected', async () => {
      const incomingPaymentId = await createIncomingPayment(100);
      const outgoingPaymentId = randomUUID();
      await paymentsClient.createOutgoingPayment(
        outgoingPaymentId,
        senderWalletAddressId,
        SENDER_WALLET_ADDRESS,
        incomingPaymentId,
        undefined,
        100
      );

      try {
        await paymentsClient.approveOutgoingPayment(
          outgoingPaymentId,
          randomUUID()
        );
        assert.fail('expected error for unknown incoming payment');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });
  });
});
