import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { PalClient } from 'pal-client-lib';
import { IPayment, PaymentsClient } from 'payments-client-lib';
import resourceServerOpenApiJsonSchema from '../../../open-payments-specifications/json/resource-server.json';
import { outgoingPaymentRoutes } from '../src/routes/outgoing-payments';
import { errorHandler } from '../src/errors';
import { FastifyOpenApiValidator } from '../src/validator';
import { encodeCompoundId } from '../src/utils';

const OPEN_PAYMENTS_URL = 'https://op.example';
const WALLET_ADDRESS_URL = `${OPEN_PAYMENTS_URL}/alice`;
const PAYMENT_INTENT_ID = 'intent-1';
const QUOTE_ID = 'quote-1';

const palClient = {
  resolveWalletAddressByAlias: async () => ({
    id: 'wa-1',
    publicName: 'Alice',
    assetCode: 'USD',
    assetScale: 2,
    isActive: true
  })
} as unknown as PalClient;

type CreatePaymentArgs = Parameters<PaymentsClient['createPayment']>;

/** Records the createPayment arguments and echoes metadata back, like the payments BC. */
function paymentsClient(calls: CreatePaymentArgs[]): PaymentsClient {
  return {
    createQuote: async () => ({
      id: QUOTE_ID,
      paymentIntentId: PAYMENT_INTENT_ID
    }),
    createPayment: async (...args: CreatePaymentArgs) => {
      calls.push(args);
      const [id, , walletAddressId, walletAddress, quoteId] = args;
      const metadata = args[8];
      const payment: IPayment = {
        id,
        state: 'FUNDING',
        senderWalletAddress: walletAddress,
        senderWalletAddressId: walletAddressId,
        paymentIntentId: PAYMENT_INTENT_ID,
        quoteId,
        debitAmount: { value: 500n, assetCode: 'USD', assetScale: 2 },
        receiveAmount: { value: 500n, assetCode: 'USD', assetScale: 2 },
        sentAmount: { value: 0n, assetCode: 'USD', assetScale: 2 },
        createdAt: new Date().toISOString(),
        ...(metadata ? { metadata } : {})
      };
      return { id, paymentIntentId: PAYMENT_INTENT_ID, payment };
    }
  } as unknown as PaymentsClient;
}

// Validates request bodies against the Open Payments spec, like service.ts.
async function appFor(calls: CreatePaymentArgs[]) {
  const app = Fastify();
  const validator = new FastifyOpenApiValidator(
    resourceServerOpenApiJsonSchema
  );
  validator.addFormat('uint64', {
    validate: (data: string) => {
      try {
        return BigInt(data) >= BigInt(0);
      } catch {
        return false;
      }
    }
  });
  app.setValidatorCompiler(({ schema }) => validator.compile(schema));
  app.setErrorHandler(errorHandler);
  await app.register(outgoingPaymentRoutes, {
    palClient,
    paymentsClient: paymentsClient(calls),
    openPaymentsUrl: OPEN_PAYMENTS_URL
  });
  return app;
}

const metadata = { description: 'Order #4711', externalRef: 'INV-4711' };

const fromQuote = (extra: Record<string, unknown> = {}) => ({
  walletAddress: WALLET_ADDRESS_URL,
  quoteId: `${OPEN_PAYMENTS_URL}/quotes/${encodeCompoundId(PAYMENT_INTENT_ID, QUOTE_ID)}`,
  ...extra
});

const fromIncomingPayment = (extra: Record<string, unknown> = {}) => ({
  walletAddress: WALLET_ADDRESS_URL,
  incomingPayment: `https://peer.example/incoming-payments/${PAYMENT_INTENT_ID}`,
  debitAmount: { value: '500', assetCode: 'USD', assetScale: 2 },
  ...extra
});

describe('POST /outgoing-payments', () => {
  test('passes metadata to createPayment and returns it when created from a quote', async () => {
    const calls: CreatePaymentArgs[] = [];
    const app = await appFor(calls);

    const response = await app.inject({
      method: 'POST',
      url: '/outgoing-payments',
      payload: fromQuote({ metadata })
    });

    assert.equal(response.statusCode, 201);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][8], metadata);
    assert.deepEqual(response.json().metadata, metadata);
  });

  test('passes metadata to createPayment and returns it when created from an incoming payment', async () => {
    const calls: CreatePaymentArgs[] = [];
    const app = await appFor(calls);

    const response = await app.inject({
      method: 'POST',
      url: '/outgoing-payments',
      payload: fromIncomingPayment({ metadata })
    });

    assert.equal(response.statusCode, 201);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][8], metadata);
    assert.deepEqual(response.json().metadata, metadata);
  });

  test('creates the payment without metadata when the request has none', async () => {
    const calls: CreatePaymentArgs[] = [];
    const app = await appFor(calls);

    for (const payload of [fromQuote(), fromIncomingPayment()]) {
      const response = await app.inject({
        method: 'POST',
        url: '/outgoing-payments',
        payload
      });

      assert.equal(response.statusCode, 201);
      assert.equal('metadata' in response.json(), false);
    }
    assert.equal(calls.length, 2);
    assert.equal(calls[0][8], undefined);
    assert.equal(calls[1][8], undefined);
  });

  test('rejects metadata that is not an object', async () => {
    const calls: CreatePaymentArgs[] = [];
    const app = await appFor(calls);

    const response = await app.inject({
      method: 'POST',
      url: '/outgoing-payments',
      payload: fromQuote({ metadata: 'Order #4711' })
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'invalid_request');
    assert.equal(calls.length, 0);
  });
});
