import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PalClient } from 'pal-client-lib';
import { assetRoutes } from '../src/routes/assets.js';
import { createTestApp } from './helpers.js';

test('POST /assets creates an asset', async () => {
  const created: Array<{ code: string; scale: number }> = [];
  const app = createTestApp();
  app.register(assetRoutes, {
    palClient: {
      createAsset: async (code: string, scale: number) => {
        created.push({ code, scale });
      }
    } as unknown as PalClient
  });

  const response = await app.inject({
    method: 'POST',
    url: '/assets',
    payload: { code: 'USD', scale: 2 }
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json(), { code: 'USD' });
  assert.deepEqual(created, [{ code: 'USD', scale: 2 }]);
});

test('POST /assets maps duplicate assets to 409', async () => {
  const app = createTestApp();
  app.register(assetRoutes, {
    palClient: {
      createAsset: async () => {
        throw new Error('Asset already exists');
      }
    } as unknown as PalClient
  });

  const response = await app.inject({
    method: 'POST',
    url: '/assets',
    payload: { code: 'USD', scale: 2 }
  });

  assert.equal(response.statusCode, 409);
  assert.match(response.json().error, /already exists/);
});

test('GET /assets returns mapped assets', async () => {
  const app = createTestApp();
  app.register(assetRoutes, {
    palClient: {
      getAssets: async () => [
        { code: 'USD', scale: 2 },
        { code: 'EUR', scale: 2 }
      ]
    } as unknown as PalClient
  });

  const response = await app.inject({ method: 'GET', url: '/assets' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    assets: [
      { code: 'USD', scale: 2 },
      { code: 'EUR', scale: 2 }
    ]
  });
});

test('POST /assets validates required fields', async () => {
  const app = createTestApp();
  app.register(assetRoutes, { palClient: {} as PalClient });

  const response = await app.inject({
    method: 'POST',
    url: '/assets',
    payload: { code: 'USD' }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, 'FST_ERR_VALIDATION');
  assert.match(response.json().message, /scale/);
});
