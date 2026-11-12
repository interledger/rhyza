import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import { AccessItem, AuthClient, IntrospectTokenResult } from 'auth-client-lib';
import { PalClient } from 'pal-client-lib';
import { GetPaymentIntentResult, PaymentsClient } from 'payments-client-lib';
import { createStreamServer } from 'ilp-client-lib';
import { incomingPaymentRoutes } from '../src/routes/incoming-payments';
import { errorHandler } from '../src/errors';
import { FastifyOpenApiValidator } from '../src/validator';
import resourceServerOpenApiJsonSchema from '../../../open-payments-specifications/json/resource-server.json';
import { activeResult, signedAuthHeaders, stubAuthClient } from './helpers';

const OPEN_PAYMENTS_URL = 'https://op.example';
const AUTH_SERVER_URL = 'https://auth.example';
const PAYMENT_INTENT_ID = 'intent-1';

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

function paymentsClient(completed: string[]): PaymentsClient {
  return {
    getPaymentIntent: async () => paymentIntent,
    completePaymentIntent: async (id: string) => {
      completed.push(id);
      return { ...paymentIntent, state: 'COMPLETED' };
    }
  } as unknown as PaymentsClient;
}

async function createTestApp(
  authClient: AuthClient,
  completed: string[] = []
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
    palClient: {} as PalClient,
    paymentsClient: paymentsClient(completed),
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

const accessFor = (
  actions: string[],
  identifier?: string
): IntrospectTokenResult =>
  activeResult([
    {
      type: 'INCOMING_PAYMENT',
      actions,
      ...(identifier ? { identifier } : {})
    } as AccessItem
  ]);

describe('GET /incoming-payments/:id', () => {
  test('serves the public view without a token', async () => {
    const app = await createTestApp(stubAuthClient(accessFor(['READ'])));

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
    const app = await createTestApp(
      stubAuthClient(accessFor(['READ'], `${OPEN_PAYMENTS_URL}/alice`))
    );

    const response = await app.inject({
      method: 'GET',
      url: `/incoming-payments/${PAYMENT_INTENT_ID}`,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().walletAddress, `${OPEN_PAYMENTS_URL}/alice`);
  });

  test('403 for a grant scoped to a different wallet address', async () => {
    const app = await createTestApp(
      stubAuthClient(accessFor(['READ'], `${OPEN_PAYMENTS_URL}/bob`))
    );

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
});

describe('POST /incoming-payments/:id/complete', () => {
  test('401 without a token', async () => {
    const completed: string[] = [];
    const app = await createTestApp(
      stubAuthClient(accessFor(['COMPLETE'])),
      completed
    );

    const response = await app.inject({
      method: 'POST',
      url: `/incoming-payments/${PAYMENT_INTENT_ID}/complete`
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(completed, []);
  });

  test('completes for a grant scoped to the receiving wallet address', async () => {
    const completed: string[] = [];
    const app = await createTestApp(
      stubAuthClient(accessFor(['COMPLETE'], `${OPEN_PAYMENTS_URL}/alice`)),
      completed
    );

    const response = await app.inject({
      method: 'POST',
      url: `/incoming-payments/${PAYMENT_INTENT_ID}/complete`,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(completed, [PAYMENT_INTENT_ID]);
  });

  test('403 and does not complete for a grant scoped to a different wallet address', async () => {
    const completed: string[] = [];
    const app = await createTestApp(
      stubAuthClient(accessFor(['COMPLETE'], `${OPEN_PAYMENTS_URL}/bob`)),
      completed
    );

    const response = await app.inject({
      method: 'POST',
      url: `/incoming-payments/${PAYMENT_INTENT_ID}/complete`,
      headers: signedAuthHeaders()
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(completed, []);
  });
});
