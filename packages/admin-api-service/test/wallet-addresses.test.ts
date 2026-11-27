import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PalClient } from 'pal-client-lib';
import { walletAddressRoutes } from '../src/routes/wallet-addresses.js';
import { createTestApp } from './helpers.js';

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
  const app = createTestApp();
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

test('POST /wallet-addresses validates required fields', async () => {
  let called = false;
  const app = await appFor(
    palClient({
      createWalletAddress: async () => {
        called = true;
        throw new Error('should not be called');
      }
    } as Partial<PalClient>)
  );

  const response = await app.inject({
    method: 'POST',
    url: '/wallet-addresses',
    payload: {
      pathName: 'alice',
      publicName: 'Alice'
    }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, 'FST_ERR_VALIDATION');
  assert.match(response.json().message, /assetCode/);
  assert.equal(called, false);
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

test('POST /wallet-addresses/:id/keys registers a valid JWK', async () => {
  let registered:
    | {
        walletAddressId: string;
        key: Parameters<PalClient['addWalletAddressKey']>[1];
      }
    | undefined;
  const app = await appFor(
    palClient({
      addWalletAddressKey: async (walletAddressId, key) => {
        registered = { walletAddressId, key };
        return 'key-record-1';
      }
    } as Partial<PalClient>)
  );
  const key = {
    kid: 'key-1',
    alg: 'EdDSA' as const,
    use: 'sig' as const,
    kty: 'OKP' as const,
    crv: 'Ed25519' as const,
    x: 'public_key'
  };

  const response = await app.inject({
    method: 'POST',
    url: '/wallet-addresses/wallet-1/keys',
    payload: key
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json(), { id: 'key-record-1' });
  assert.deepEqual(registered, {
    walletAddressId: 'wallet-1',
    key
  });
});

test('POST /wallet-addresses/:id/keys validates the JWK', async () => {
  const app = await appFor();

  const response = await app.inject({
    method: 'POST',
    url: '/wallet-addresses/wallet-1/keys',
    payload: {
      kid: 'key-1',
      alg: 'RS256',
      kty: 'OKP',
      crv: 'Ed25519',
      x: 'public_key'
    }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, 'FST_ERR_VALIDATION');
  assert.match(response.json().message, /alg/);
});
