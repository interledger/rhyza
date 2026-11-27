import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PalClient } from 'pal-client-lib';
import { PaymentsClient } from 'payments-client-lib';
import { paymentRoutes } from '../src/routes/payments.js';
import { createTestApp } from './helpers.js';

function paymentApp(paymentsClient: PaymentsClient = {} as PaymentsClient) {
  const app = createTestApp();
  app.register(paymentRoutes, {
    palClient: {
      resolveWalletAddressByAlias: async () => null
    } as unknown as PalClient,
    paymentsClient
  });
  return app;
}

test('POST /payments requires exactly one payment-intent identifier', async () => {
  const app = paymentApp();
  const base = { walletAddress: 'https://wallet.example/alice' };

  for (const payload of [
    base,
    {
      ...base,
      paymentIntentId: 'intent-1',
      paymentIntentUrl: 'https://remote.example/incoming-payments/intent-1'
    }
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: '/payments',
      payload
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 'FST_ERR_VALIDATION');
  }
});

test('POST /payments accepts either payment-intent identifier', async () => {
  const app = paymentApp();
  const base = { walletAddress: 'https://wallet.example/alice' };

  for (const payload of [
    { ...base, paymentIntentId: 'intent-1' },
    {
      ...base,
      paymentIntentUrl: 'https://remote.example/incoming-payments/intent-1'
    }
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: '/payments',
      payload
    });

    // Validation passed and the handler attempted to resolve the wallet.
    assert.equal(response.statusCode, 404);
  }
});

test('POST payment cancellation validates and forwards its body', async () => {
  const cancellations: Array<{
    intentId: string;
    id: string;
    reason: string | undefined;
  }> = [];
  const app = paymentApp({
    cancelPayment: async (
      intentId: string,
      id: string,
      reason: string | undefined
    ) => {
      cancellations.push({ intentId, id, reason });
    }
  } as unknown as PaymentsClient);

  const validResponse = await app.inject({
    method: 'POST',
    url: '/payment-intents/intent-1/payments/payment-1/cancel',
    payload: { reason: 'duplicate' }
  });
  assert.equal(validResponse.statusCode, 200);
  assert.deepEqual(cancellations, [
    {
      intentId: 'intent-1',
      id: 'payment-1',
      reason: 'duplicate'
    }
  ]);

  const invalidResponse = await app.inject({
    method: 'POST',
    url: '/payment-intents/intent-1/payments/payment-1/cancel',
    payload: { reason: 123 }
  });
  assert.equal(invalidResponse.statusCode, 400);
  assert.equal(invalidResponse.json().code, 'FST_ERR_VALIDATION');
  assert.equal(cancellations.length, 1);
});
