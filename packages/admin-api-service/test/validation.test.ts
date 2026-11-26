import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { IlpClient } from 'ilp-client-lib';
import { PalClient } from 'pal-client-lib';
import { PaymentsClient } from 'payments-client-lib';
import { assetRoutes } from '../src/routes/assets.js';
import { liquidityRoutes } from '../src/routes/liquidity.js';
import { paymentRoutes } from '../src/routes/payments.js';
import { peerRoutes } from '../src/routes/peers.js';
import { quoteRoutes } from '../src/routes/quotes.js';
import { ratesRoutes } from '../src/routes/rates.js';
import { walletAddressRoutes } from '../src/routes/wallet-addresses.js';
import { createTestApp } from './helpers.js';

describe('OpenAPI request validation', () => {
  test('rejects invalid asset, peer, liquidity, rate, and JWK bodies', async () => {
    const cases = [
      {
        routes: assetRoutes,
        options: { palClient: {} as PalClient },
        url: '/assets',
        payload: { code: 'USD' }
      },
      {
        routes: peerRoutes,
        options: {
          palClient: {} as PalClient,
          ilpClient: {} as IlpClient
        },
        url: '/peers',
        payload: {
          id: 'peer-1',
          name: 'Peer',
          assetCode: 'USD',
          assetScale: 2,
          ilpStaticAddress: 'g.peer'
        }
      },
      {
        routes: liquidityRoutes,
        options: { palClient: {} as PalClient },
        url: '/liquidity/deposit',
        payload: {
          assetCode: 'USD',
          peerId: 'peer-1',
          amount: 1.5,
          amountScale: 2
        }
      },
      {
        routes: ratesRoutes,
        options: { palClient: {} as PalClient },
        url: '/rates',
        payload: {
          sourceAssetCode: 'USD',
          destinationAssetCode: 'EUR',
          rate: 0,
          peerId: null,
          rateTtlSecs: 60
        }
      },
      {
        routes: walletAddressRoutes,
        options: {
          palClient: {} as PalClient,
          openPaymentsUrl: undefined
        },
        url: '/wallet-addresses/wallet-1/keys',
        payload: {
          kid: 'key-1',
          alg: 'RS256',
          kty: 'OKP',
          crv: 'Ed25519',
          x: 'public-key'
        }
      }
    ] as const;

    for (const testCase of cases) {
      const app = createTestApp();
      // Each tuple carries the options required by its corresponding plugin.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app.register(testCase.routes as any, testCase.options);

      const response = await app.inject({
        method: 'POST',
        url: testCase.url,
        payload: testCase.payload
      });

      assert.equal(response.statusCode, 400, testCase.url);
      assert.equal(response.json().code, 'FST_ERR_VALIDATION', testCase.url);
      await app.close();
    }
  });

  test('enforces payment and quote payment-intent alternatives', async () => {
    const palClient = {
      resolveWalletAddressByAlias: async () => null
    } as unknown as PalClient;

    for (const routes of [paymentRoutes, quoteRoutes]) {
      const app = createTestApp();
      app.register(routes, {
        palClient,
        paymentsClient: {} as PaymentsClient
      });
      const url = routes === paymentRoutes ? '/payments' : '/quotes';
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
          url,
          payload
        });
        assert.equal(response.statusCode, 400);
        assert.equal(response.json().code, 'FST_ERR_VALIDATION');
      }

      for (const payload of [
        { ...base, paymentIntentId: 'intent-1' },
        {
          ...base,
          paymentIntentUrl: 'https://remote.example/incoming-payments/intent-1'
        }
      ]) {
        const response = await app.inject({
          method: 'POST',
          url,
          payload
        });
        assert.equal(response.statusCode, 404);
      }

      await app.close();
    }
  });

  test('accepts a valid payment cancellation body and rejects a wrong type', async () => {
    const cancellations: Array<{
      intentId: string;
      id: string;
      reason: string | undefined;
    }> = [];
    const app = createTestApp();
    app.register(paymentRoutes, {
      palClient: {} as PalClient,
      paymentsClient: {
        cancelPayment: async (
          intentId: string,
          id: string,
          reason: string | undefined
        ) => {
          cancellations.push({ intentId, id, reason });
        }
      } as unknown as PaymentsClient
    });

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
});
