import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { AccessItem, AuthClient, IntrospectTokenResult } from 'auth-client-lib';
import { PalClient } from 'pal-client-lib';
import { IPayment, PaymentsClient } from 'payments-client-lib';
import resourceServerOpenApiJsonSchema from '../../../open-payments-specifications/json/resource-server.json';
import { outgoingPaymentRoutes } from '../src/routes/outgoing-payments';
import { createErrorHandler } from '../src/errors';
import { NullLogger } from 'common-types-lib';
import { FastifyOpenApiValidator } from '../src/validator';
import { encodeCompoundId } from '../src/utils';
import {
  activeResult,
  GRANT_ID,
  IntrospectCall,
  signedAuthHeaders,
  stubAuthClient
} from './helpers';

const OPEN_PAYMENTS_URL = 'https://op.example';
const AUTH_SERVER_URL = 'https://auth.example';
const WALLET_ADDRESS_URL = `${OPEN_PAYMENTS_URL}/alice`;
const PAYMENT_INTENT_ID = 'intent-1';
const QUOTE_ID = 'quote-1';
const PAYMENT_ID = 'payment-1';
const PAYMENT_PATH = `/outgoing-payments/${encodeCompoundId(PAYMENT_INTENT_ID, PAYMENT_ID)}`;

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

const storedPayment: IPayment = {
  id: PAYMENT_ID,
  state: 'COMPLETED',
  senderWalletAddress: WALLET_ADDRESS_URL,
  senderWalletAddressId: 'wa-1',
  paymentIntentId: PAYMENT_INTENT_ID,
  quoteId: QUOTE_ID,
  debitAmount: { value: 500n, assetCode: 'USD', assetScale: 2 },
  receiveAmount: { value: 500n, assetCode: 'USD', assetScale: 2 },
  sentAmount: { value: 500n, assetCode: 'USD', assetScale: 2 },
  createdAt: new Date().toISOString()
};

/** Records the createPayment arguments and echoes metadata back, like the payments BC. */
function paymentsClient(calls: CreatePaymentArgs[]): PaymentsClient {
  return {
    getPayment: async () => storedPayment,
    getPaymentsPage: async () => ({
      pagination: { hasNextPage: false, hasPreviousPage: false },
      items: [storedPayment]
    }),
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
async function appFor(
  calls: CreatePaymentArgs[],
  authClient: AuthClient = stubAuthClient(accessFor(['CREATE']))
) {
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
  app.setErrorHandler(createErrorHandler(new NullLogger()));
  app.decorateRequest('grantAccess', null);
  app.decorateRequest('grantId', null);
  await app.register(outgoingPaymentRoutes, {
    palClient,
    paymentsClient: paymentsClient(calls),
    authClient,
    openPaymentsUrl: OPEN_PAYMENTS_URL,
    openPaymentsAuthServiceUrl: AUTH_SERVER_URL
  });
  return app;
}

const accessFor = (
  actions: string[],
  identifier?: string
): IntrospectTokenResult =>
  activeResult([
    {
      type: 'OUTGOING_PAYMENT',
      actions,
      ...(identifier ? { identifier } : {})
    } as AccessItem
  ]);

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
      headers: signedAuthHeaders(),
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
      headers: signedAuthHeaders(),
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
        headers: signedAuthHeaders(),
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
      headers: signedAuthHeaders(),
      payload: fromQuote({ metadata: 'Order #4711' })
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'invalid_request');
    assert.equal(calls.length, 0);
  });
});

describe('POST /outgoing-payments token introspection', () => {
  test('returns 401 without a token', async () => {
    const calls: CreatePaymentArgs[] = [];
    const app = await appFor(calls);

    const response = await app.inject({
      method: 'POST',
      url: '/outgoing-payments',
      payload: fromQuote()
    });

    assert.equal(response.statusCode, 401);
    assert.equal(
      response.headers['www-authenticate'],
      `GNAP as_uri=${AUTH_SERVER_URL}`
    );
    assert.equal(calls.length, 0);
  });

  test('introspects for the body wallet address and passes the grant id to createPayment', async () => {
    const introspectCalls: IntrospectCall[] = [];
    const calls: CreatePaymentArgs[] = [];
    const app = await appFor(
      calls,
      stubAuthClient(accessFor(['CREATE'], WALLET_ADDRESS_URL), introspectCalls)
    );

    const response = await app.inject({
      method: 'POST',
      url: '/outgoing-payments',
      headers: signedAuthHeaders(),
      payload: fromQuote()
    });

    assert.equal(response.statusCode, 201);
    assert.deepEqual(introspectCalls[0]?.access, [
      {
        type: 'OUTGOING_PAYMENT',
        actions: ['CREATE'],
        identifier: WALLET_ADDRESS_URL
      }
    ]);
    assert.equal(calls[0]?.[7], GRANT_ID);
  });

  test('returns 403 when the grant has no matching access', async () => {
    const calls: CreatePaymentArgs[] = [];
    const app = await appFor(calls, stubAuthClient(activeResult([])));

    const response = await app.inject({
      method: 'POST',
      url: '/outgoing-payments',
      headers: signedAuthHeaders(),
      payload: fromQuote()
    });

    assert.equal(response.statusCode, 403);
    assert.equal(calls.length, 0);
  });
});

describe('GET /outgoing-payments/:id', () => {
  test('returns 401 without a token', async () => {
    const app = await appFor([], stubAuthClient(accessFor(['READ'])));

    const response = await app.inject({ method: 'GET', url: PAYMENT_PATH });

    assert.equal(response.statusCode, 401);
    assert.equal(
      response.headers['www-authenticate'],
      `GNAP as_uri=${AUTH_SERVER_URL}`
    );
  });

  test('returns 200 for outgoing payment read access', async () => {
    const calls: IntrospectCall[] = [];
    const app = await appFor([], stubAuthClient(accessFor(['READ']), calls));

    const response = await app.inject({
      method: 'GET',
      url: PAYMENT_PATH,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(calls[0]?.access, [
      { type: 'OUTGOING_PAYMENT', actions: ['READ'] }
    ]);
  });

  test('returns 200 for a grant scoped to the sending wallet address', async () => {
    const app = await appFor(
      [],
      stubAuthClient(accessFor(['READ'], WALLET_ADDRESS_URL))
    );

    const response = await app.inject({
      method: 'GET',
      url: PAYMENT_PATH,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().walletAddress, WALLET_ADDRESS_URL);
  });

  test('returns 403 for a grant scoped to a different wallet address', async () => {
    const app = await appFor(
      [],
      stubAuthClient(accessFor(['READ'], `${OPEN_PAYMENTS_URL}/bob`))
    );

    const response = await app.inject({
      method: 'GET',
      url: PAYMENT_PATH,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.description, 'Insufficient Grant');
  });
});

describe('GET /outgoing-payments', () => {
  const listUrl = `/outgoing-payments?wallet-address=${encodeURIComponent(WALLET_ADDRESS_URL)}`;

  test('returns 401 without a token', async () => {
    const app = await appFor([], stubAuthClient(accessFor(['LIST'])));

    const response = await app.inject({ method: 'GET', url: listUrl });

    assert.equal(response.statusCode, 401);
  });

  test('introspects for the queried wallet address and returns the page', async () => {
    const calls: IntrospectCall[] = [];
    const app = await appFor(
      [],
      stubAuthClient(accessFor(['LIST'], WALLET_ADDRESS_URL), calls)
    );

    const response = await app.inject({
      method: 'GET',
      url: listUrl,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().result.length, 1);
    assert.deepEqual(calls[0]?.access, [
      {
        type: 'OUTGOING_PAYMENT',
        actions: ['LIST'],
        identifier: WALLET_ADDRESS_URL
      }
    ]);
  });

  test('returns 403 when the grant has no matching access', async () => {
    const app = await appFor([], stubAuthClient(activeResult([])));

    const response = await app.inject({
      method: 'GET',
      url: listUrl,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 403);
  });
});
