import { describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import { AccessItem, AuthClient, IntrospectTokenResult } from 'auth-client-lib';
import { PalClient } from 'pal-client-lib';
import {
  createServiceError,
  GetPaymentIntentResult,
  PaymentsClient
} from 'payments-client-lib';
import { createStreamServer } from 'ilp-client-lib';
import { incomingPaymentRoutes } from '../src/routes/incoming-payments';
import { errorHandler } from '../src/errors';
import { FastifyOpenApiValidator } from '../src/validator';
import resourceServerOpenApiJsonSchema from '../../../open-payments-specifications/json/resource-server.json';
import { activeResult, signedAuthHeaders, stubAuthClient } from './helpers';

// grpc status codes, inlined to avoid depending on @grpc/grpc-js here
const GRPC_INVALID_ARGUMENT = 3;
const GRPC_NOT_FOUND = 5;
const GRPC_FAILED_PRECONDITION = 9;
const GRPC_INTERNAL = 13;

const OPEN_PAYMENTS_URL = 'https://op.example';
const AUTH_SERVER_URL = 'https://auth.example';
const PAYMENT_INTENT_ID = 'intent-1';
const ALICE = `${OPEN_PAYMENTS_URL}/alice`;
const BOB = `${OPEN_PAYMENTS_URL}/bob`;

const paymentIntent: GetPaymentIntentResult = {
  id: PAYMENT_INTENT_ID,
  receiverWalletAddress: 'alice',
  state: 'PENDING',
  destination: 'LOCAL',
  receivedAmount: 0n,
  assetCode: 'USD',
  assetScale: 2,
  createdAt: new Date().toISOString()
};

function mockPaymentsClient(): PaymentsClient {
  return {
    getPaymentIntent: async () => paymentIntent,
    completePaymentIntent: async () => ({
      ...paymentIntent,
      state: 'COMPLETED'
    })
  } as unknown as PaymentsClient;
}

/** PalClient stub resolving every alias to the receiving wallet address. */
function mockPalClient(): PalClient {
  return {
    resolveWalletAddressByAlias: async () => ({
      id: 'wallet-address-1',
      assetCode: 'USD',
      assetScale: 2
    })
  } as unknown as PalClient;
}

async function createTestApp(
  authClient: AuthClient,
  overrides: Partial<PaymentsClient> = {}
): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify();
  const validator = new FastifyOpenApiValidator(
    resourceServerOpenApiJsonSchema
  );
  validator.addFormat('uint64', { validate: () => true });
  app.setValidatorCompiler(({ schema }) => validator.compile(schema));
  app.setErrorHandler(errorHandler);
  app.decorateRequest('grantAccess', null);
  await app.register(incomingPaymentRoutes, {
    palClient: mockPalClient(),
    paymentsClient: Object.assign(mockPaymentsClient(), overrides),
    authClient,
    streamServer: createStreamServer({
      serverSecret: randomBytes(32),
      serverAddress: 'test.rhyza'
    }),
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
  activeResult([
    {
      type: 'INCOMING_PAYMENT',
      actions,
      ...(walletAddress ? { identifier: walletAddress } : {})
    } as AccessItem
  ]);

describe('createIncomingPayment', () => {
  const createBody = {
    walletAddress: ALICE,
    incomingAmount: { value: '100', assetCode: 'USD', assetScale: 2 }
  };

  test('maps INVALID_ARGUMENT to 400 invalid_request', async () => {
    const app = await createTestApp(
      stubAuthClient(tokenWith(['CREATE'], ALICE)),
      {
        createPaymentIntent: async () => {
          throw createServiceError(GRPC_INVALID_ARGUMENT, 'bad argument');
        }
      } as unknown as Partial<PaymentsClient>
    );

    const response = await app.inject({
      method: 'POST',
      url: '/incoming-payments',
      headers: signedAuthHeaders(),
      payload: createBody
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json().error, {
      code: 'invalid_request',
      description: 'Could not create incoming payment'
    });
  });

  test('maps an unexpected grpc error to 500', async () => {
    const app = await createTestApp(
      stubAuthClient(tokenWith(['CREATE'], ALICE)),
      {
        createPaymentIntent: async () => {
          throw createServiceError(GRPC_INTERNAL, 'unexpected');
        }
      } as unknown as Partial<PaymentsClient>
    );

    const response = await app.inject({
      method: 'POST',
      url: '/incoming-payments',
      headers: signedAuthHeaders(),
      payload: createBody
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json().error, {
      code: 'internal_server_error',
      description: 'Could not create incoming payment'
    });
  });
});

describe('getIncomingPayment', () => {
  test('serves the public view without a token', async () => {
    const app = await createTestApp(stubAuthClient(tokenWith(['READ'])));

    const response = await app.inject({
      method: 'GET',
      url: `/incoming-payments/${PAYMENT_INTENT_ID}`
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.authServer, AUTH_SERVER_URL);
    assert.equal(body.walletAddress, undefined);
  });

  test('serves the full view to a grant scoped to the receiving wallet address', async () => {
    const app = await createTestApp(stubAuthClient(tokenWith(['READ'], ALICE)));

    const response = await app.inject({
      method: 'GET',
      url: `/incoming-payments/${PAYMENT_INTENT_ID}`,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().walletAddress, ALICE);
  });

  test('403 for a grant scoped to a different wallet address', async () => {
    const app = await createTestApp(stubAuthClient(tokenWith(['READ'], BOB)));

    const response = await app.inject({
      method: 'GET',
      url: `/incoming-payments/${PAYMENT_INTENT_ID}`,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.description, 'Insufficient Grant');
  });

  test('returns 403 for an inactive token instead of falling back to the public view', async () => {
    const app = await createTestApp(
      stubAuthClient({ active: false, grantId: 'grant-1', access: [] })
    );

    const response = await app.inject({
      method: 'GET',
      url: `/incoming-payments/${PAYMENT_INTENT_ID}`,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 403);
  });

  test('maps NOT_FOUND to 404 not_found', async () => {
    const app = await createTestApp(
      stubAuthClient(tokenWith(['READ'], ALICE)),
      {
        getPaymentIntent: async () => {
          throw createServiceError(GRPC_NOT_FOUND, 'no such intent');
        }
      } as unknown as Partial<PaymentsClient>
    );

    const response = await app.inject({
      method: 'GET',
      url: `/incoming-payments/${PAYMENT_INTENT_ID}`,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json().error, {
      code: 'not_found',
      description: 'Incoming payment not found'
    });
  });

  test('maps an unexpected grpc error to 500', async () => {
    const app = await createTestApp(
      stubAuthClient(tokenWith(['READ'], ALICE)),
      {
        getPaymentIntent: async () => {
          throw createServiceError(GRPC_INTERNAL, 'unexpected');
        }
      } as unknown as Partial<PaymentsClient>
    );

    const response = await app.inject({
      method: 'GET',
      url: `/incoming-payments/${PAYMENT_INTENT_ID}`,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json().error, {
      code: 'internal_server_error',
      description: 'Could not get incoming payment'
    });
  });
});

describe('listIncomingPayments', () => {
  test('maps an unexpected grpc error to 500', async () => {
    const app = await createTestApp(
      stubAuthClient(tokenWith(['LIST'], ALICE)),
      {
        getPaymentIntentsPage: async () => {
          throw createServiceError(GRPC_INTERNAL, 'unexpected');
        }
      } as unknown as Partial<PaymentsClient>
    );

    const response = await app.inject({
      method: 'GET',
      url: `/incoming-payments?wallet-address=${ALICE}`,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json().error, {
      code: 'internal_server_error',
      description: 'Could not list incoming payments'
    });
  });
});

describe('completeIncomingPayment', () => {
  const completePaymentIntentMockFn = () =>
    mock.fn(async () => ({ ...paymentIntent, state: 'COMPLETED' }));

  test('401 without a token', async () => {
    const completeMockFn = completePaymentIntentMockFn();
    const app = await createTestApp(stubAuthClient(tokenWith(['COMPLETE'])), {
      completePaymentIntent: completeMockFn
    } as unknown as Partial<PaymentsClient>);

    const response = await app.inject({
      method: 'POST',
      url: `/incoming-payments/${PAYMENT_INTENT_ID}/complete`
    });

    assert.equal(response.statusCode, 401);
    assert.equal(completeMockFn.mock.callCount(), 0);
  });

  test('completes for a grant scoped to the receiving wallet address', async () => {
    const completeMockFn = completePaymentIntentMockFn();
    const app = await createTestApp(
      stubAuthClient(tokenWith(['COMPLETE'], ALICE)),
      {
        completePaymentIntent: completeMockFn
      } as unknown as Partial<PaymentsClient>
    );

    const response = await app.inject({
      method: 'POST',
      url: `/incoming-payments/${PAYMENT_INTENT_ID}/complete`,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 200);
    assert.equal(completeMockFn.mock.callCount(), 1);
    assert.deepEqual(completeMockFn.mock.calls[0].arguments, [
      PAYMENT_INTENT_ID
    ]);
  });

  test('403 and does not complete for a grant scoped to a different wallet address', async () => {
    const complete = completePaymentIntentMockFn();
    const app = await createTestApp(
      stubAuthClient(tokenWith(['COMPLETE'], BOB)),
      {
        completePaymentIntent: complete
      } as unknown as Partial<PaymentsClient>
    );

    const response = await app.inject({
      method: 'POST',
      url: `/incoming-payments/${PAYMENT_INTENT_ID}/complete`,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 403);
    assert.equal(complete.mock.callCount(), 0);
  });

  test('maps NOT_FOUND on the grant pre-check to 404 not_found', async () => {
    const app = await createTestApp(
      stubAuthClient(tokenWith(['COMPLETE'], ALICE)),
      {
        getPaymentIntent: async () => {
          throw createServiceError(GRPC_NOT_FOUND, 'no such intent');
        }
      } as unknown as Partial<PaymentsClient>
    );

    const response = await app.inject({
      method: 'POST',
      url: `/incoming-payments/${PAYMENT_INTENT_ID}/complete`,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json().error, {
      code: 'not_found',
      description: 'Incoming payment not found'
    });
  });

  test('maps FAILED_PRECONDITION to 400 invalid_request', async () => {
    const app = await createTestApp(
      stubAuthClient(tokenWith(['COMPLETE'], ALICE)),
      {
        completePaymentIntent: async () => {
          throw createServiceError(
            GRPC_FAILED_PRECONDITION,
            'already complete'
          );
        }
      } as unknown as Partial<PaymentsClient>
    );

    const response = await app.inject({
      method: 'POST',
      url: `/incoming-payments/${PAYMENT_INTENT_ID}/complete`,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json().error, {
      code: 'invalid_request',
      description: 'Could not complete incoming payment'
    });
  });

  test('maps an unexpected grpc error to 500', async () => {
    const app = await createTestApp(
      stubAuthClient(tokenWith(['COMPLETE'], ALICE)),
      {
        completePaymentIntent: async () => {
          throw createServiceError(GRPC_INTERNAL, 'unexpected');
        }
      } as unknown as Partial<PaymentsClient>
    );

    const response = await app.inject({
      method: 'POST',
      url: `/incoming-payments/${PAYMENT_INTENT_ID}/complete`,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json().error, {
      code: 'internal_server_error',
      description: 'Could not complete incoming payment'
    });
  });
});
