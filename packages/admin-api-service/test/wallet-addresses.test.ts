import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { PalClient } from 'pal-client-lib';
import { walletAddressRoutes } from '../src/routes/wallet-addresses.js';

function palClient(overrides: Partial<PalClient> = {}): PalClient {
  return {
    createWalletAddress: async () => ({
      id: 'wa-1',
      domain: null,
      pathName: 'alice',
      publicName: 'Alice',
      assetCode: 'USD',
      assetScale: 2,
      isActive: true
    }),
    ...overrides
  } as unknown as PalClient;
}

async function appFor(client: PalClient = palClient()) {
  const app = Fastify();
  await app.register(walletAddressRoutes, {
    palClient: client,
    openPaymentsUrl: 'https://op.example'
  });
  return app;
}

test('POST /wallet-addresses creates with pathName and returns the OP resource server URL', async () => {
  let created: { domain: unknown; pathName: unknown } | undefined;
  const app = await appFor(
    palClient({
      createWalletAddress: async (domain, pathName) => {
        created = { domain, pathName };
        return {
          id: 'wa-1',
          domain,
          pathName,
          publicName: 'Alice',
          assetCode: 'USD',
          assetScale: 2,
          isActive: true
        };
      }
    } as Partial<PalClient>)
  );

  const response = await app.inject({
    method: 'POST',
    url: '/wallet-addresses',
    payload: {
      pathName: 'alice',
      publicName: 'Alice',
      assetCode: 'USD'
    }
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json(), {
    id: 'wa-1',
    address: 'https://op.example/alice'
  });
  assert.deepEqual(created, { domain: null, pathName: 'alice' });
});

test('POST /wallet-addresses rejects a full URL pathName', async () => {
  const app = await appFor();
  const response = await app.inject({
    method: 'POST',
    url: '/wallet-addresses',
    payload: {
      pathName: 'https://wallet.com/alice',
      publicName: 'Alice',
      assetCode: 'USD'
    }
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /pathName/);
});

test('POST /wallet-addresses rejects a pathName that contains a slash', async () => {
  const app = await appFor();
  const response = await app.inject({
    method: 'POST',
    url: '/wallet-addresses',
    payload: {
      pathName: 'wallet.com/alice',
      publicName: 'Alice',
      assetCode: 'USD'
    }
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /pathName/);
});
