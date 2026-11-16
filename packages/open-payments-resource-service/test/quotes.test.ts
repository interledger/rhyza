import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { AccessItem, AuthClient, IntrospectTokenResult } from 'auth-client-lib';
import { PalClient } from 'pal-client-lib';
import {
  CreateQuoteResult,
  GetPaymentIntentResult,
  GetQuoteResult,
  PaymentsClient
} from 'payments-client-lib';
import resourceServerOpenApiJsonSchema from '../../../open-payments-specifications/json/resource-server.json';
import { quoteRoutes } from '../src/routes/quotes';
import { errorHandler } from '../src/errors';
import { FastifyOpenApiValidator } from '../src/validator';
import { encodeCompoundId } from '../src/utils';
import {
  activeResult,
  IntrospectCall,
  signedAuthHeaders,
  stubAuthClient
} from './helpers';

const OPEN_PAYMENTS_URL = 'https://op.example';
const AUTH_SERVER_URL = 'https://auth.example';
const WALLET_ADDRESS_URL = `${OPEN_PAYMENTS_URL}/alice`;
const PAYMENT_INTENT_ID = 'intent-1';
const QUOTE_ID = 'quote-1';
const QUOTE_PATH = `/quotes/${encodeCompoundId(PAYMENT_INTENT_ID, QUOTE_ID)}`;

const palClient = {
  resolveWalletAddressByAlias: async () => ({
    id: 'wa-1',
    publicName: 'Alice',
    assetCode: 'USD',
    assetScale: 2,
    isActive: true
  }),
  getWalletAddresses: async () => [
    { id: 'wa-1', assetCode: 'USD', assetScale: 2 }
  ]
} as unknown as PalClient;

const quote: GetQuoteResult = {
  id: QUOTE_ID,
  paymentIntentId: PAYMENT_INTENT_ID,
  state: 'COMPLETED',
  senderWalletAddress: WALLET_ADDRESS_URL,
  senderWalletAddressId: 'wa-1',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  debitAmount: 500n,
  receiveAmount: 500n
};

const paymentIntent: GetPaymentIntentResult = {
  id: PAYMENT_INTENT_ID,
  receiverWalletAddress: 'bob',
  state: 'PENDING',
  destination: 'LOCAL',
  receivedAmount: 0n,
  assetCode: 'USD',
  assetScale: 2,
  createdAt: new Date().toISOString()
};

function paymentsClient(created: string[]): PaymentsClient {
  return {
    getQuote: async () => quote,
    getPaymentIntent: async () => paymentIntent,
    createQuote: async (id: string): Promise<CreateQuoteResult> => {
      created.push(id);
      return {
        id,
        paymentIntentId: PAYMENT_INTENT_ID,
        senderWalletAddress: WALLET_ADDRESS_URL,
        senderWalletAddressId: 'wa-1',
        expiresAt: quote.expiresAt!,
        createdAt: quote.createdAt,
        debitAmount: 500n,
        receiveAmount: 500n,
        exchangeRate: 1
      };
    }
  } as unknown as PaymentsClient;
}

async function createTestApp(authClient: AuthClient, created: string[] = []) {
  const app = Fastify();
  const validator = new FastifyOpenApiValidator(
    resourceServerOpenApiJsonSchema
  );
  validator.addFormat('uint64', { validate: () => true });
  app.setValidatorCompiler(({ schema }) => validator.compile(schema));
  app.setErrorHandler(errorHandler);
  app.decorateRequest('grantAccess', null);
  await app.register(quoteRoutes, {
    palClient,
    paymentsClient: paymentsClient(created),
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
      type: 'QUOTE',
      actions,
      ...(identifier ? { identifier } : {})
    } as AccessItem
  ]);

const createQuoteBody = {
  walletAddress: WALLET_ADDRESS_URL,
  receiver: `https://peer.example/incoming-payments/${PAYMENT_INTENT_ID}`,
  method: 'ilp',
  debitAmount: { value: '500', assetCode: 'USD', assetScale: 2 }
};

describe('GET /quotes/:id', () => {
  test('returns 401 without a token', async () => {
    const app = await createTestApp(stubAuthClient(accessFor(['READ'])));

    const response = await app.inject({ method: 'GET', url: QUOTE_PATH });

    assert.equal(response.statusCode, 401);
    assert.equal(
      response.headers['www-authenticate'],
      `GNAP as_uri=${AUTH_SERVER_URL}`
    );
  });

  test('returns 200 for quote read access', async () => {
    const calls: IntrospectCall[] = [];
    const app = await createTestApp(stubAuthClient(accessFor(['READ']), calls));

    const response = await app.inject({
      method: 'GET',
      url: QUOTE_PATH,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(calls[0]?.access, [{ type: 'QUOTE', actions: ['READ'] }]);
  });

  test('returns 200 for a grant scoped to the sending wallet address', async () => {
    const app = await createTestApp(
      stubAuthClient(accessFor(['READ'], WALLET_ADDRESS_URL))
    );

    const response = await app.inject({
      method: 'GET',
      url: QUOTE_PATH,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().walletAddress, WALLET_ADDRESS_URL);
  });

  test('returns 403 for a grant scoped to a different wallet address', async () => {
    const app = await createTestApp(
      stubAuthClient(accessFor(['READ'], `${OPEN_PAYMENTS_URL}/bob`))
    );

    const response = await app.inject({
      method: 'GET',
      url: QUOTE_PATH,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.description, 'Insufficient Grant');
  });
});

describe('POST /quotes', () => {
  test('returns 401 without a token', async () => {
    const created: string[] = [];
    const app = await createTestApp(
      stubAuthClient(accessFor(['CREATE'])),
      created
    );

    const response = await app.inject({
      method: 'POST',
      url: '/quotes',
      payload: createQuoteBody
    });

    assert.equal(response.statusCode, 401);
    assert.equal(created.length, 0);
  });

  test('returns 201 for a grant scoped to the body wallet address', async () => {
    const calls: IntrospectCall[] = [];
    const created: string[] = [];
    const app = await createTestApp(
      stubAuthClient(accessFor(['CREATE'], WALLET_ADDRESS_URL), calls),
      created
    );

    const response = await app.inject({
      method: 'POST',
      url: '/quotes',
      headers: signedAuthHeaders(),
      payload: createQuoteBody
    });

    assert.equal(response.statusCode, 201);
    assert.equal(created.length, 1);
    assert.deepEqual(calls[0]?.access, [
      { type: 'QUOTE', actions: ['CREATE'], identifier: WALLET_ADDRESS_URL }
    ]);
  });

  test('returns 403 when the grant has no matching access', async () => {
    const created: string[] = [];
    const app = await createTestApp(stubAuthClient(activeResult([])), created);

    const response = await app.inject({
      method: 'POST',
      url: '/quotes',
      headers: signedAuthHeaders(),
      payload: createQuoteBody
    });

    assert.equal(response.statusCode, 403);
    assert.equal(created.length, 0);
  });
});
