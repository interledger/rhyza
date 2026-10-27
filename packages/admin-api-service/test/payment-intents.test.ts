import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { PalClient } from 'pal-client-lib';
import { PaymentsClient } from 'payments-client-lib';
import { paymentIntentRoutes } from '../src/routes/payment-intents.js';

test('POST /payment-intents resolves a full walletAddressUrl by pathName only', async () => {
  let resolved: { domain: unknown; pathName: unknown } | undefined;
  const app = Fastify();
  await app.register(paymentIntentRoutes, {
    palClient: {
      resolveWalletAddressAlias: async (domain, pathName) => {
        resolved = { domain, pathName };
        return { domain: null, pathName, walletAddressId: 'wa-1' };
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
      incomingAmount: '100'
    }
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(resolved, { domain: null, pathName: 'alice' });
});
