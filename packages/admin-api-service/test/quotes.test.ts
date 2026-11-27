import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PalClient } from 'pal-client-lib';
import { PaymentsClient } from 'payments-client-lib';
import { quoteRoutes } from '../src/routes/quotes.js';
import { createTestApp } from './helpers.js';

function quoteApp() {
  const app = createTestApp();
  app.register(quoteRoutes, {
    palClient: {
      resolveWalletAddressByAlias: async () => null
    } as unknown as PalClient,
    paymentsClient: {} as PaymentsClient
  });
  return app;
}

test('POST /quotes requires exactly one payment-intent identifier', async () => {
  const app = quoteApp();
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
      url: '/quotes',
      payload
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 'FST_ERR_VALIDATION');
  }
});

test('POST /quotes accepts either payment-intent identifier', async () => {
  const app = quoteApp();
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
      url: '/quotes',
      payload
    });

    // Validation passed and the handler attempted to resolve the wallet.
    assert.equal(response.statusCode, 404);
  }
});
