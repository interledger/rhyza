import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PalClient } from 'pal-client-lib';
import { PaymentsClient } from 'payments-client-lib';
import { paymentIntentRoutes } from '../src/routes/payment-intents.js';
import { createTestApp } from './helpers.js';

test('POST /payment-intents resolves a full walletAddressUrl by pathName only', async () => {
  let resolved: { domain: unknown; pathName: unknown } | undefined;
  const app = createTestApp();
  await app.register(paymentIntentRoutes, {
    palClient: {
      resolveWalletAddressByAlias: async (
        domain: string | null,
        pathName: string
      ) => {
        resolved = { domain, pathName };
        return {
          id: 'wa-1',
          publicName: 'Alice',
          assetCode: 'USD',
          assetScale: 2,
          isActive: true
        };
      }
    } as unknown as PalClient,
    paymentsClient: {
      createPaymentIntent: async () => ({ id: 'pi-1' })
    } as unknown as PaymentsClient,
    openPaymentsUrl: 'https://op.example'
  });

  const response = await app.inject({
    method: 'POST',
    url: '/payment-intents',
    payload: {
      walletAddress: 'https://wallet.com/alice',
      incomingAmount: 100
    }
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(resolved, { domain: null, pathName: 'alice' });
});

async function buildApp(createPaymentIntent: (...args: unknown[]) => unknown) {
  const app = createTestApp();
  await app.register(paymentIntentRoutes, {
    palClient: {
      resolveWalletAddressByAlias: async () => ({
        id: 'wa-1',
        publicName: 'Alice',
        assetCode: 'USD',
        assetScale: 2,
        isActive: true
      })
    } as unknown as PalClient,
    paymentsClient: {
      createPaymentIntent
    } as unknown as PaymentsClient,
    openPaymentsUrl: undefined
  });
  return app;
}

test('POST /payment-intents forwards a JSON string expiresAt as ISO', async () => {
  let forwardedExpiresAt: unknown;
  const app = await buildApp(async (...args: unknown[]) => {
    forwardedExpiresAt = args[4];
    return { id: 'pi-1' };
  });

  const response = await app.inject({
    method: 'POST',
    url: '/payment-intents',
    payload: {
      walletAddress: 'https://ilp.example/alice',
      expiresAt: '2030-01-01T00:00:00.000Z'
    }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(forwardedExpiresAt, '2030-01-01T00:00:00.000Z');
});

test('POST /payment-intents returns 400 for an invalid expiresAt', async () => {
  let called = false;
  const app = await buildApp(async () => {
    called = true;
    return { id: 'pi-1' };
  });

  const response = await app.inject({
    method: 'POST',
    url: '/payment-intents',
    payload: {
      walletAddress: 'https://ilp.example/alice',
      expiresAt: 'not-a-date'
    }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, 'FST_ERR_VALIDATION');
  assert.equal(called, false);
});

test('POST /payment-intents validates required fields', async () => {
  let called = false;
  const app = await buildApp(async () => {
    called = true;
    return { id: 'pi-1' };
  });

  const response = await app.inject({
    method: 'POST',
    url: '/payment-intents',
    payload: { incomingAmount: 100 }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, 'FST_ERR_VALIDATION');
  assert.match(response.json().message, /walletAddress/);
  assert.equal(called, false);
});

const paymentIntent = {
  id: 'pi-1',
  receiverWalletAddress: 'https://wallet.example/alice',
  state: 'ACTIVE',
  destination: 'g.example.alice',
  receivedAmount: BigInt(25),
  incomingAmount: BigInt(100),
  assetCode: 'USD',
  assetScale: 2,
  createdAt: '2026-01-01T00:00:00.000Z'
};

test('GET /payment-intents returns mapped paginated results', async () => {
  const app = createTestApp();
  await app.register(paymentIntentRoutes, {
    palClient: {} as PalClient,
    paymentsClient: {
      getPaymentIntentsPage: async () => ({
        items: [paymentIntent],
        pagination: { hasNextPage: false, hasPreviousPage: false }
      })
    } as unknown as PaymentsClient,
    openPaymentsUrl: undefined
  });

  const response = await app.inject({
    method: 'GET',
    url: '/payment-intents'
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    result: [
      {
        id: 'pi-1',
        state: 'ACTIVE',
        destination: 'g.example.alice',
        walletAddress: 'https://wallet.example/alice',
        incomingAmount: {
          value: '100',
          assetCode: 'USD',
          assetScale: 2
        },
        receivedAmount: {
          value: '25',
          assetCode: 'USD',
          assetScale: 2
        },
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ],
    pagination: { hasNextPage: false, hasPreviousPage: false }
  });
});

test('GET /payment-intents/:id returns a mapped payment intent', async () => {
  const app = createTestApp();
  await app.register(paymentIntentRoutes, {
    palClient: {} as PalClient,
    paymentsClient: {
      getPaymentIntent: async () => paymentIntent
    } as unknown as PaymentsClient,
    openPaymentsUrl: undefined
  });

  const response = await app.inject({
    method: 'GET',
    url: '/payment-intents/pi-1'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().id, 'pi-1');
  assert.equal(response.json().receivedAmount.value, '25');
});
