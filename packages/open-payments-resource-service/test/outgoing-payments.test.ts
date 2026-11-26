import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {
  AccessItem,
  AuthClient,
  AuthClientGrantNotFoundError,
  AuthClientInsufficientGrantError,
  AuthClientInvalidGrantError,
  IntrospectTokenResult
} from 'auth-client-lib';
import { PalClient } from 'pal-client-lib';
import {
  createServiceError,
  IPayment,
  PaymentsClient
} from 'payments-client-lib';
import resourceServerOpenApiJsonSchema from '../../../open-payments-specifications/json/resource-server.json';
import { outgoingPaymentRoutes } from '../src/routes/outgoing-payments';
import { createErrorHandler } from '../src/errors';
import { NullLogger } from 'common-types-lib';
import { FastifyOpenApiValidator } from '../src/validator';
import { encodeCompoundId } from '../src/utils';
import {
  activeTokenIntrospectionResult,
  GRANT_ID,
  IntrospectTokenCall,
  signedAuthHeaders,
  stubAuthClient,
  ValidateGrantLimitCall
} from './helpers';

const OPEN_PAYMENTS_URL = 'https://op.example';
const AUTH_SERVER_URL = 'https://auth.example';
const WALLET_ADDRESS_URL = `${OPEN_PAYMENTS_URL}/alice`;
const PAYMENT_INTENT_ID = 'intent-1';
const QUOTE_ID = 'quote-1';
const PAYMENT_ID = 'payment-1';
const PAYMENT_PATH = `/outgoing-payments/${encodeCompoundId(PAYMENT_INTENT_ID, PAYMENT_ID)}`;

const GRPC_INVALID_ARGUMENT = 3;
const GRPC_NOT_FOUND = 5;
const GRPC_FAILED_PRECONDITION = 9;
const GRPC_INTERNAL = 13;

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
function paymentsClient(
  calls: CreatePaymentArgs[],
  quoteAmounts: { debitAmount?: bigint; receiveAmount?: bigint } = {
    debitAmount: EXISTING_QUOTE_DEBIT,
    receiveAmount: EXISTING_QUOTE_RECEIVE
  }
): PaymentsClient {
  return {
    getPayment: async () => storedPayment,
    getQuote: async () => ({
      id: QUOTE_ID,
      paymentIntentId: PAYMENT_INTENT_ID,
      ...quoteAmounts
    }),
    getPaymentsPage: async () => ({
      pagination: { hasNextPage: false, hasPreviousPage: false },
      items: [storedPayment]
    }),
    createQuote: async () => ({
      id: QUOTE_ID,
      paymentIntentId: PAYMENT_INTENT_ID,
      debitAmount: 500n,
      receiveAmount: CREATED_QUOTE_RECEIVE
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
async function createTestApp(
  authClient: AuthClient,
  overrides: {
    createPaymentCalls?: CreatePaymentArgs[];
    quoteAmounts?: { debitAmount?: bigint; receiveAmount?: bigint };
    paymentsClient?: Partial<PaymentsClient>;
    palClient?: Partial<PalClient>;
  } = {}
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
    palClient: Object.assign(palClient, overrides.palClient ?? {}),
    paymentsClient: Object.assign(
      paymentsClient(
        overrides.createPaymentCalls ?? [],
        ...(overrides.quoteAmounts ? [overrides.quoteAmounts] : [])
      ),
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
      type: 'OUTGOING_PAYMENT',
      actions,
      ...(walletAddress ? { identifier: walletAddress } : {})
    } as AccessItem
  ]);

const EXISTING_QUOTE_DEBIT = 700n;
const EXISTING_QUOTE_RECEIVE = 650n;
const CREATED_QUOTE_RECEIVE = 480n;

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
    const app = await createTestApp(stubAuthClient(tokenWith(['CREATE'])), {
      createPaymentCalls: calls
    });

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
    const app = await createTestApp(stubAuthClient(tokenWith(['CREATE'])), {
      createPaymentCalls: calls
    });

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
    const app = await createTestApp(stubAuthClient(tokenWith(['CREATE'])), {
      createPaymentCalls: calls
    });

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
    const app = await createTestApp(stubAuthClient(tokenWith(['CREATE'])), {
      createPaymentCalls: calls
    });

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

  test('maps INVALID_ARGUMENT to 400 invalid_request', async () => {
    const app = await createTestApp(stubAuthClient(tokenWith(['CREATE'])), {
      paymentsClient: {
        createPayment: async () => {
          throw createServiceError(GRPC_INVALID_ARGUMENT, 'bad argument');
        }
      } as unknown as Partial<PaymentsClient>
    });

    const response = await app.inject({
      method: 'POST',
      url: '/outgoing-payments',
      headers: signedAuthHeaders(),
      payload: fromQuote()
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json().error, {
      code: 'invalid_request',
      description: 'Could not create outgoing payment'
    });
  });

  test('maps FAILED_PRECONDITION to 400 invalid_request', async () => {
    const app = await createTestApp(stubAuthClient(tokenWith(['CREATE'])), {
      paymentsClient: {
        createPayment: async () => {
          throw createServiceError(GRPC_FAILED_PRECONDITION, 'quote expired');
        }
      } as unknown as Partial<PaymentsClient>
    });

    const response = await app.inject({
      method: 'POST',
      url: '/outgoing-payments',
      headers: signedAuthHeaders(),
      payload: fromQuote()
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json().error, {
      code: 'invalid_request',
      description: 'Could not create outgoing payment'
    });
  });

  test('maps NOT_FOUND to 500', async () => {
    const app = await createTestApp(stubAuthClient(tokenWith(['CREATE'])), {
      paymentsClient: {
        createPayment: async () => {
          throw createServiceError(GRPC_NOT_FOUND, 'no such quote');
        }
      } as unknown as Partial<PaymentsClient>
    });

    const response = await app.inject({
      method: 'POST',
      url: '/outgoing-payments',
      headers: signedAuthHeaders(),
      payload: fromQuote()
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json().error, {
      code: 'internal_server_error',
      description: 'Could not create outgoing payment'
    });
  });

  test('maps an unexpected grpc error to 500', async () => {
    const app = await createTestApp(stubAuthClient(tokenWith(['CREATE'])), {
      paymentsClient: {
        createPayment: async () => {
          throw createServiceError(GRPC_INTERNAL, 'unexpected');
        }
      } as unknown as Partial<PaymentsClient>
    });

    const response = await app.inject({
      method: 'POST',
      url: '/outgoing-payments',
      headers: signedAuthHeaders(),
      payload: fromQuote()
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json().error, {
      code: 'internal_server_error',
      description: 'Could not create outgoing payment'
    });
  });

  test('returns 401 without a token', async () => {
    const calls: CreatePaymentArgs[] = [];
    const app = await createTestApp(stubAuthClient(tokenWith(['CREATE'])), {
      createPaymentCalls: calls
    });

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
    const introspectCalls: IntrospectTokenCall[] = [];
    const calls: CreatePaymentArgs[] = [];
    const app = await createTestApp(
      stubAuthClient(
        tokenWith(['CREATE'], WALLET_ADDRESS_URL),
        introspectCalls
      ),
      { createPaymentCalls: calls }
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
    const app = await createTestApp(
      stubAuthClient(activeTokenIntrospectionResult([])),
      { createPaymentCalls: calls }
    );

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

describe('POST /outgoing-payments grant spend limit', () => {
  test('validates the existing quote amounts and creates the payment with the same createdAt', async () => {
    const validateCalls: ValidateGrantLimitCall[] = [];
    const calls: CreatePaymentArgs[] = [];
    const app = await createTestApp(
      stubAuthClient(tokenWith(['CREATE']), [], { calls: validateCalls }),
      { createPaymentCalls: calls }
    );

    const response = await app.inject({
      method: 'POST',
      url: '/outgoing-payments',
      headers: signedAuthHeaders(),
      payload: fromQuote()
    });

    assert.equal(response.statusCode, 201);
    assert.equal(validateCalls.length, 1);
    const [validateCall] = validateCalls;
    assert.equal(validateCall.grantId, GRANT_ID);
    assert.equal(validateCall.debitAmount, EXISTING_QUOTE_DEBIT);
    assert.equal(validateCall.receiveAmount, EXISTING_QUOTE_RECEIVE);
    assert.ok(!Number.isNaN(Date.parse(validateCall.createdAt)));
    assert.equal(calls[0]?.[4], QUOTE_ID);
    assert.equal(calls[0]?.[6], validateCall.createdAt);
    assert.equal(calls[0]?.[7], GRANT_ID);
  });

  test('validates the internally created quote amounts when created from an incoming payment', async () => {
    const validateCalls: ValidateGrantLimitCall[] = [];
    const calls: CreatePaymentArgs[] = [];
    const app = await createTestApp(
      stubAuthClient(tokenWith(['CREATE']), [], { calls: validateCalls }),
      { createPaymentCalls: calls }
    );

    const response = await app.inject({
      method: 'POST',
      url: '/outgoing-payments',
      headers: signedAuthHeaders(),
      payload: fromIncomingPayment()
    });

    assert.equal(response.statusCode, 201);
    assert.equal(validateCalls.length, 1);
    assert.equal(validateCalls[0].debitAmount, 500n);
    assert.equal(validateCalls[0].receiveAmount, CREATED_QUOTE_RECEIVE);
    assert.equal(calls[0]?.[6], validateCalls[0].createdAt);
  });

  test('returns 403 and does not create the payment on AuthClientInsufficientGrantError', async () => {
    const calls: CreatePaymentArgs[] = [];
    const app = await createTestApp(
      stubAuthClient(tokenWith(['CREATE']), [], {
        error: new AuthClientInsufficientGrantError()
      }),
      { createPaymentCalls: calls }
    );

    for (const payload of [fromQuote(), fromIncomingPayment()]) {
      const response = await app.inject({
        method: 'POST',
        url: '/outgoing-payments',
        headers: signedAuthHeaders(),
        payload
      });

      assert.equal(response.statusCode, 403);
      assert.deepEqual(response.json(), {
        error: {
          code: 'insufficient_grant',
          description: 'Insufficient Grant'
        }
      });
    }
    assert.equal(calls.length, 0);
  });

  test('returns 403 and does not create the payment on AuthClientInvalidGrantError', async () => {
    const calls: CreatePaymentArgs[] = [];
    const app = await createTestApp(
      stubAuthClient(tokenWith(['CREATE']), [], {
        error: new AuthClientInvalidGrantError()
      }),
      { createPaymentCalls: calls }
    );

    for (const payload of [fromQuote(), fromIncomingPayment()]) {
      const response = await app.inject({
        method: 'POST',
        url: '/outgoing-payments',
        headers: signedAuthHeaders(),
        payload
      });

      assert.equal(response.statusCode, 403);
      assert.deepEqual(response.json(), {
        error: {
          code: 'insufficient_grant',
          description: 'Insufficient Grant'
        }
      });
    }
    assert.equal(calls.length, 0);
  });

  test('returns 500 and does not create the payment on other auth errors', async () => {
    const calls: CreatePaymentArgs[] = [];
    const app = await createTestApp(
      stubAuthClient(tokenWith(['CREATE']), [], {
        error: new AuthClientGrantNotFoundError()
      }),
      { createPaymentCalls: calls }
    );

    const response = await app.inject({
      method: 'POST',
      url: '/outgoing-payments',
      headers: signedAuthHeaders(),
      payload: fromQuote()
    });

    assert.equal(response.statusCode, 500);
    assert.equal(calls.length, 0);
  });

  test('returns 400 and skips the limit check when the existing quote has no amounts', async () => {
    const validateCalls: ValidateGrantLimitCall[] = [];
    const calls: CreatePaymentArgs[] = [];
    const app = await createTestApp(
      stubAuthClient(tokenWith(['CREATE']), [], { calls: validateCalls }),
      { createPaymentCalls: calls, quoteAmounts: {} }
    );

    const response = await app.inject({
      method: 'POST',
      url: '/outgoing-payments',
      headers: signedAuthHeaders(),
      payload: fromQuote()
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'invalid_request');
    assert.equal(validateCalls.length, 0);
    assert.equal(calls.length, 0);
  });
});

describe('GET /outgoing-payments/:id', () => {
  test('returns 401 without a token', async () => {
    const app = await createTestApp(stubAuthClient(tokenWith(['READ'])));

    const response = await app.inject({ method: 'GET', url: PAYMENT_PATH });

    assert.equal(response.statusCode, 401);
    assert.equal(
      response.headers['www-authenticate'],
      `GNAP as_uri=${AUTH_SERVER_URL}`
    );
  });

  test('returns 200 for outgoing payment read access', async () => {
    const calls: IntrospectTokenCall[] = [];
    const app = await createTestApp(stubAuthClient(tokenWith(['READ']), calls));

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
    const app = await createTestApp(
      stubAuthClient(tokenWith(['READ'], WALLET_ADDRESS_URL))
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
    const app = await createTestApp(
      stubAuthClient(tokenWith(['READ'], `${OPEN_PAYMENTS_URL}/bob`))
    );

    const response = await app.inject({
      method: 'GET',
      url: PAYMENT_PATH,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.description, 'Insufficient Grant');
  });

  test('maps NOT_FOUND to 404 not_found', async () => {
    const app = await createTestApp(stubAuthClient(tokenWith(['READ'])), {
      paymentsClient: {
        getPayment: async () => {
          throw createServiceError(GRPC_NOT_FOUND, 'no such payment');
        }
      } as unknown as Partial<PaymentsClient>
    });

    const response = await app.inject({
      method: 'GET',
      url: PAYMENT_PATH,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json().error, {
      code: 'not_found',
      description: 'Outgoing payment not found'
    });
  });

  test('maps an unexpected grpc error to 500', async () => {
    const app = await createTestApp(stubAuthClient(tokenWith(['READ'])), {
      paymentsClient: {
        getPayment: async () => {
          throw createServiceError(GRPC_INTERNAL, 'unexpected');
        }
      } as unknown as Partial<PaymentsClient>
    });

    const response = await app.inject({
      method: 'GET',
      url: PAYMENT_PATH,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json().error, {
      code: 'internal_server_error',
      description: 'Could not get outgoing payment'
    });
  });
});

describe('GET /outgoing-payments', () => {
  const listUrl = `/outgoing-payments?wallet-address=${encodeURIComponent(WALLET_ADDRESS_URL)}`;

  test('returns 401 without a token', async () => {
    const app = await createTestApp(stubAuthClient(tokenWith(['LIST'])));

    const response = await app.inject({ method: 'GET', url: listUrl });

    assert.equal(response.statusCode, 401);
  });

  test('introspects for the queried wallet address and returns the page', async () => {
    const calls: IntrospectTokenCall[] = [];
    const app = await createTestApp(
      stubAuthClient(tokenWith(['LIST'], WALLET_ADDRESS_URL), calls)
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
    const app = await createTestApp(
      stubAuthClient(activeTokenIntrospectionResult([]))
    );

    const response = await app.inject({
      method: 'GET',
      url: listUrl,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 403);
  });

  test('maps INVALID_ARGUMENT to 400 invalid_request', async () => {
    const app = await createTestApp(stubAuthClient(tokenWith(['LIST'])), {
      paymentsClient: {
        getPaymentsPage: async () => {
          throw createServiceError(GRPC_INVALID_ARGUMENT, 'bad cursor');
        }
      } as unknown as Partial<PaymentsClient>
    });

    const response = await app.inject({
      method: 'GET',
      url: listUrl,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json().error, {
      code: 'invalid_request',
      description: 'Could not list outgoing payments'
    });
  });

  test('maps an unexpected grpc error to 500', async () => {
    const app = await createTestApp(stubAuthClient(tokenWith(['LIST'])), {
      paymentsClient: {
        getPaymentsPage: async () => {
          throw createServiceError(GRPC_INTERNAL, 'unexpected');
        }
      } as unknown as Partial<PaymentsClient>
    });

    const response = await app.inject({
      method: 'GET',
      url: listUrl,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json().error, {
      code: 'internal_server_error',
      description: 'Could not list outgoing payments'
    });
  });
});
