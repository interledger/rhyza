import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { PalClient } from 'pal-client-lib';
import { walletAddressRoutes } from '../src/routes/wallet-addresses';
import { errorHandler } from '../src/errors';

function palClient(state: 'active' | 'inactive' | 'missing'): PalClient {
  return {
    ResolveWalletAddressAlias: async () =>
      state === 'missing'
        ? null
        : { domain: null, pathName: 'alice', walletAddressId: 'wa-1' },
    getWalletAddresses: async () =>
      state === 'missing'
        ? []
        : [
            {
              id: 'wa-1',
              publicName: 'Alice',
              assetCode: 'USD',
              assetScale: 2,
              isActive: state === 'active'
            }
          ]
  } as unknown as PalClient;
}

async function appFor(state: 'active' | 'inactive' | 'missing') {
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(walletAddressRoutes, {
    palClient: palClient(state),
    openPaymentsResourceServiceUrl: 'https://op.example',
    openPaymentsAuthServiceUrl: 'https://auth.example'
  });
  return app;
}

test('GET wallet address returns the document when the address is active', async () => {
  const app = await appFor('active');
  const response = await app.inject({ method: 'GET', url: '/alice' });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().publicName, 'Alice');
  assert.equal(response.json().id, 'https://op.example/alice');
});

test('GET wallet address returns not found when the address is deactivated', async () => {
  const app = await appFor('inactive');
  const response = await app.inject({ method: 'GET', url: '/alice' });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, 'not_found');
});

test('GET wallet address returns the document again after the address is reactivated', async () => {
  let active = false;
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(walletAddressRoutes, {
    palClient: {
      ResolveWalletAddressAlias: async () => ({
        domain: null,
        pathName: 'alice',
        walletAddressId: 'wa-1'
      }),
      getWalletAddresses: async () => [
        {
          id: 'wa-1',
          publicName: 'Alice',
          assetCode: 'USD',
          assetScale: 2,
          isActive: active
        }
      ]
    } as unknown as PalClient,
    openPaymentsResourceServiceUrl: 'https://op.example',
    openPaymentsAuthServiceUrl: 'https://auth.example'
  });

  const hidden = await app.inject({ method: 'GET', url: '/alice' });
  assert.equal(hidden.statusCode, 404);

  active = true;
  const shown = await app.inject({ method: 'GET', url: '/alice' });
  assert.equal(shown.statusCode, 200);
  assert.equal(shown.json().publicName, 'Alice');
});

test('GET wallet address returns not found when the alias does not exist', async () => {
  const app = await appFor('missing');
  const response = await app.inject({ method: 'GET', url: '/alice' });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, 'not_found');
});
