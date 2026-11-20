import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { AccessItem, AuthClient, IntrospectTokenResult } from 'auth-client-lib';
import { PalClient } from 'pal-client-lib';
import {
  createServiceError,
  CreateQuoteResult,
  GetPaymentIntentResult,
  GetQuoteResult,
  PaymentsClient
} from 'payments-client-lib';
import { NullLogger } from 'common-types-lib';
import resourceServerOpenApiJsonSchema from '../../../open-payments-specifications/json/resource-server.json';
import { quoteRoutes } from '../src/routes/quotes';
import { createErrorHandler } from '../src/errors';
import { FastifyOpenApiValidator } from '../src/validator';
import { encodeCompoundId } from '../src/utils';
import {
  activeTokenIntrospectionResult,
  IntrospectTokenCall,
  signedAuthHeaders,
  stubAuthClient
} from './helpers';

// grpc status codes, inlined to avoid depending on @grpc/grpc-js here
const GRPC_INVALID_ARGUMENT = 3;
const GRPC_NOT_FOUND = 5;
const GRPC_FAILED_PRECONDITION = 9;
const GRPC_INTERNAL = 13;

const OPEN_PAYMENTS_URL = 'https://op.example';
const AUTH_SERVER_URL = 'https://auth.example';
const WALLET_ADDRESS_URL = `${OPEN_PAYMENTS_URL}/alice`;
const PAYMENT_INTENT_ID = 'intent-1';
const QUOTE_ID = 'quote-1';
const QUOTE_PATH = `/quotes/${encodeCompoundId(PAYMENT_INTENT_ID, QUOTE_ID)}`;

function mockPalClient(): PalClient {
  return {
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
}

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

function mockPaymentsClient(createdQuoteIds: string[]): PaymentsClient {
  return {
    getQuote: async () => quote,
    getPaymentIntent: async () => paymentIntent,
    createQuote: async (id: string): Promise<CreateQuoteResult> => {
      createdQuoteIds.push(id);
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

async function createTestApp(
  authClient: AuthClient,
  overrides: {
    createdQuoteIds?: string[];
    paymentsClient?: Partial<PaymentsClient>;
    palClient?: Partial<PalClient>;
  } = {}
) {
  const app = Fastify();
  const validator = new FastifyOpenApiValidator(
    resourceServerOpenApiJsonSchema
  );
  validator.addFormat('uint64', { validate: () => true });
  app.setValidatorCompiler(({ schema }) => validator.compile(schema));
  app.setErrorHandler(createErrorHandler(new NullLogger()));
  app.decorateRequest('grantAccess', null);
  await app.register(quoteRoutes, {
    palClient: Object.assign(mockPalClient(), overrides.palClient ?? {}),
    paymentsClient: Object.assign(
      mockPaymentsClient(overrides.createdQuoteIds ?? []),
      overrides.paymentsClient ?? {}
    ),
    authClient,
    openPaymentsUrl: OPEN_PAYMENTS_URL,
    openPaymentsAuthServiceUrl: AUTH_SERVER_URL
  });
  return app;
}

/** An active introspection result for a token granting `actions`. */
const tokenWith = (
  actions: string[],
  walletAddress?: string
): IntrospectTokenResult =>
  activeTokenIntrospectionResult([
    {
      type: 'QUOTE',
      actions,
      ...(walletAddress ? { identifier: walletAddress } : {})
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
    const app = await createTestApp(stubAuthClient(tokenWith(['READ'])));

    const response = await app.inject({ method: 'GET', url: QUOTE_PATH });

    assert.equal(response.statusCode, 401);
    assert.equal(
      response.headers['www-authenticate'],
      `GNAP as_uri=${AUTH_SERVER_URL}`
    );
  });

  test('returns 200 for quote read access', async () => {
    const calls: IntrospectTokenCall[] = [];
    const app = await createTestApp(stubAuthClient(tokenWith(['READ']), calls));

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
      stubAuthClient(tokenWith(['READ'], WALLET_ADDRESS_URL))
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
      stubAuthClient(tokenWith(['READ'], `${OPEN_PAYMENTS_URL}/bob`))
    );

    const response = await app.inject({
      method: 'GET',
      url: QUOTE_PATH,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.description, 'Insufficient Grant');
  });

  test('maps NOT_FOUND on the quote to 404 not_found', async () => {
    const app = await createTestApp(stubAuthClient(tokenWith(['READ'])), {
      paymentsClient: {
        getQuote: async () => {
          throw createServiceError(GRPC_NOT_FOUND, 'no such quote');
        }
      } as unknown as Partial<PaymentsClient>
    });

    const response = await app.inject({
      method: 'GET',
      url: QUOTE_PATH,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json().error, {
      code: 'not_found',
      description: 'Quote not found'
    });
  });

  test('maps an unexpected grpc error on the quote to 500', async () => {
    const app = await createTestApp(stubAuthClient(tokenWith(['READ'])), {
      paymentsClient: {
        getQuote: async () => {
          throw createServiceError(GRPC_INTERNAL, 'unexpected');
        }
      } as unknown as Partial<PaymentsClient>
    });

    const response = await app.inject({
      method: 'GET',
      url: QUOTE_PATH,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json().error, {
      code: 'internal_server_error',
      description: 'Could not get quote'
    });
  });

  test('maps NOT_FOUND on the payment intent to 404 not_found', async () => {
    const app = await createTestApp(stubAuthClient(tokenWith(['READ'])), {
      paymentsClient: {
        getPaymentIntent: async () => {
          throw createServiceError(GRPC_NOT_FOUND, 'no such intent');
        }
      } as unknown as Partial<PaymentsClient>
    });

    const response = await app.inject({
      method: 'GET',
      url: QUOTE_PATH,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json().error, {
      code: 'not_found',
      description: 'Quote not found'
    });
  });

  test('maps an unexpected grpc error on the payment intent to 500', async () => {
    const app = await createTestApp(stubAuthClient(tokenWith(['READ'])), {
      paymentsClient: {
        getPaymentIntent: async () => {
          throw createServiceError(GRPC_INTERNAL, 'unexpected');
        }
      } as unknown as Partial<PaymentsClient>
    });

    const response = await app.inject({
      method: 'GET',
      url: QUOTE_PATH,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json().error, {
      code: 'internal_server_error',
      description: 'Could not get quote'
    });
  });

  test('maps a wallet address lookup failure to 500', async () => {
    const app = await createTestApp(stubAuthClient(tokenWith(['READ'])), {
      palClient: {
        getWalletAddresses: async () => {
          throw new Error('unexpected');
        }
      } as unknown as Partial<PalClient>
    });

    const response = await app.inject({
      method: 'GET',
      url: QUOTE_PATH,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json().error, {
      code: 'internal_server_error',
      description: 'Could not get quote'
    });
  });

  test('returns 404 when the sender wallet address is missing', async () => {
    const app = await createTestApp(stubAuthClient(tokenWith(['READ'])), {
      palClient: {
        getWalletAddresses: async () => []
      } as unknown as Partial<PalClient>
    });

    const response = await app.inject({
      method: 'GET',
      url: QUOTE_PATH,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json().error, {
      code: 'not_found',
      description: 'Sender wallet address not found'
    });
  });
});

describe('POST /quotes', () => {
  test('returns 401 without a token', async () => {
    const createdQuoteIds: string[] = [];
    const app = await createTestApp(stubAuthClient(tokenWith(['CREATE'])), {
      createdQuoteIds
    });

    const response = await app.inject({
      method: 'POST',
      url: '/quotes',
      payload: createQuoteBody
    });

    assert.equal(response.statusCode, 401);
    assert.equal(createdQuoteIds.length, 0);
  });

  test('returns 201 for a grant scoped to the body wallet address', async () => {
    const calls: IntrospectTokenCall[] = [];
    const createdQuoteIds: string[] = [];
    const app = await createTestApp(
      stubAuthClient(tokenWith(['CREATE'], WALLET_ADDRESS_URL), calls),
      { createdQuoteIds }
    );

    const response = await app.inject({
      method: 'POST',
      url: '/quotes',
      headers: signedAuthHeaders(),
      payload: createQuoteBody
    });

    assert.equal(response.statusCode, 201);
    assert.equal(createdQuoteIds.length, 1);
    assert.deepEqual(calls[0]?.access, [
      { type: 'QUOTE', actions: ['CREATE'], identifier: WALLET_ADDRESS_URL }
    ]);
  });

  test('returns 403 when the grant has no matching access', async () => {
    const createdQuoteIds: string[] = [];
    const app = await createTestApp(
      stubAuthClient(activeTokenIntrospectionResult([])),
      { createdQuoteIds }
    );

    const response = await app.inject({
      method: 'POST',
      url: '/quotes',
      headers: signedAuthHeaders(),
      payload: createQuoteBody
    });

    assert.equal(response.statusCode, 403);
    assert.equal(createdQuoteIds.length, 0);
  });

  test('maps a wallet address resolution failure to 500', async () => {
    const createdQuoteIds: string[] = [];
    const app = await createTestApp(
      stubAuthClient(tokenWith(['CREATE'], WALLET_ADDRESS_URL)),
      {
        createdQuoteIds,
        palClient: {
          resolveWalletAddressByAlias: async () => {
            throw new Error('unexpected');
          }
        } as unknown as Partial<PalClient>
      }
    );

    const response = await app.inject({
      method: 'POST',
      url: '/quotes',
      headers: signedAuthHeaders(),
      payload: createQuoteBody
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json().error, {
      code: 'internal_server_error',
      description: 'Could not create quote'
    });
    assert.equal(createdQuoteIds.length, 0);
  });

  test('returns 404 for an unknown wallet address', async () => {
    const app = await createTestApp(
      stubAuthClient(tokenWith(['CREATE'], WALLET_ADDRESS_URL)),
      {
        palClient: {
          resolveWalletAddressByAlias: async () => null
        } as unknown as Partial<PalClient>
      }
    );

    const response = await app.inject({
      method: 'POST',
      url: '/quotes',
      headers: signedAuthHeaders(),
      payload: createQuoteBody
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json().error, {
      code: 'not_found',
      description: 'Wallet address not found'
    });
  });

  test('maps INVALID_ARGUMENT to 400 invalid_request', async () => {
    const app = await createTestApp(
      stubAuthClient(tokenWith(['CREATE'], WALLET_ADDRESS_URL)),
      {
        paymentsClient: {
          createQuote: async () => {
            throw createServiceError(GRPC_INVALID_ARGUMENT, 'bad argument');
          }
        } as unknown as Partial<PaymentsClient>
      }
    );

    const response = await app.inject({
      method: 'POST',
      url: '/quotes',
      headers: signedAuthHeaders(),
      payload: createQuoteBody
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json().error, {
      code: 'invalid_request',
      description: 'Could not create quote'
    });
  });

  test('maps FAILED_PRECONDITION to 400 invalid_request', async () => {
    const app = await createTestApp(
      stubAuthClient(tokenWith(['CREATE'], WALLET_ADDRESS_URL)),
      {
        paymentsClient: {
          createQuote: async () => {
            throw createServiceError(GRPC_FAILED_PRECONDITION, 'expired');
          }
        } as unknown as Partial<PaymentsClient>
      }
    );

    const response = await app.inject({
      method: 'POST',
      url: '/quotes',
      headers: signedAuthHeaders(),
      payload: createQuoteBody
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json().error, {
      code: 'invalid_request',
      description: 'Could not create quote'
    });
  });

  // NOT_FOUND here means the sender wallet address, payment intent or peer
  // could not be resolved on the payments side, none of which the client can
  // fix by correcting the request, so it is not reported as a 404.
  test('maps NOT_FOUND to 500', async () => {
    const app = await createTestApp(
      stubAuthClient(tokenWith(['CREATE'], WALLET_ADDRESS_URL)),
      {
        paymentsClient: {
          createQuote: async () => {
            throw createServiceError(GRPC_NOT_FOUND, 'no such payment intent');
          }
        } as unknown as Partial<PaymentsClient>
      }
    );

    const response = await app.inject({
      method: 'POST',
      url: '/quotes',
      headers: signedAuthHeaders(),
      payload: createQuoteBody
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json().error, {
      code: 'internal_server_error',
      description: 'Could not create quote'
    });
  });

  test('maps an unexpected grpc error to 500', async () => {
    const app = await createTestApp(
      stubAuthClient(tokenWith(['CREATE'], WALLET_ADDRESS_URL)),
      {
        paymentsClient: {
          createQuote: async () => {
            throw createServiceError(GRPC_INTERNAL, 'unexpected');
          }
        } as unknown as Partial<PaymentsClient>
      }
    );

    const response = await app.inject({
      method: 'POST',
      url: '/quotes',
      headers: signedAuthHeaders(),
      payload: createQuoteBody
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json().error, {
      code: 'internal_server_error',
      description: 'Could not create quote'
    });
  });

  test('maps a payment intent lookup failure after creation to 500', async () => {
    const app = await createTestApp(
      stubAuthClient(tokenWith(['CREATE'], WALLET_ADDRESS_URL)),
      {
        paymentsClient: {
          getPaymentIntent: async () => {
            throw createServiceError(GRPC_INTERNAL, 'unexpected');
          }
        } as unknown as Partial<PaymentsClient>
      }
    );

    const response = await app.inject({
      method: 'POST',
      url: '/quotes',
      headers: signedAuthHeaders(),
      payload: createQuoteBody
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json().error, {
      code: 'internal_server_error',
      description: 'Could not create quote'
    });
  });
});
