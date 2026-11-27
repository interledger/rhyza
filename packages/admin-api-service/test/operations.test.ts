import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PalClient } from 'pal-client-lib';
import { liquidityRoutes } from '../src/routes/liquidity.js';
import { ratesRoutes } from '../src/routes/rates.js';
import { createTestApp } from './helpers.js';

test('POST /liquidity/deposit forwards a validated deposit', async () => {
  const deposits: unknown[] = [];
  const app = createTestApp();
  app.register(liquidityRoutes, {
    palClient: {
      ledgerDepositToAse: async (deposit: unknown) => {
        deposits.push(deposit);
      }
    } as unknown as PalClient
  });

  const response = await app.inject({
    method: 'POST',
    url: '/liquidity/deposit',
    payload: {
      assetCode: 'USD',
      peerId: 'peer-1',
      amount: 100,
      amountScale: 2
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(typeof response.json().id, 'string');
  assert.deepEqual(deposits, [
    {
      requestId: response.json().id,
      peerId: 'peer-1',
      amount: '100',
      assetCode: 'USD',
      amountScale: 2
    }
  ]);
});

test('POST /rates forwards a validated exchange rate', async () => {
  const calls: unknown[][] = [];
  const app = createTestApp();
  app.register(ratesRoutes, {
    palClient: {
      setFxRate: async (...args: unknown[]) => {
        calls.push(args);
      }
    } as unknown as PalClient
  });

  const response = await app.inject({
    method: 'POST',
    url: '/rates',
    payload: {
      sourceAssetCode: 'USD',
      destinationAssetCode: 'EUR',
      rate: 0.9,
      peerId: null,
      rateTtlSecs: 60
    }
  });

  assert.equal(response.statusCode, 204);
  assert.deepEqual(calls, [['USD', 'EUR', 0.9, null, 60]]);
});

test('POST /liquidity/deposit validates integer amounts', async () => {
  const app = createTestApp();
  app.register(liquidityRoutes, { palClient: {} as PalClient });

  const response = await app.inject({
    method: 'POST',
    url: '/liquidity/deposit',
    payload: {
      assetCode: 'USD',
      peerId: 'peer-1',
      amount: 1.5,
      amountScale: 2
    }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, 'FST_ERR_VALIDATION');
  assert.match(response.json().message, /amount/);
});

test('POST /rates validates positive rates', async () => {
  const app = createTestApp();
  app.register(ratesRoutes, { palClient: {} as PalClient });

  const response = await app.inject({
    method: 'POST',
    url: '/rates',
    payload: {
      sourceAssetCode: 'USD',
      destinationAssetCode: 'EUR',
      rate: 0,
      peerId: null,
      rateTtlSecs: 60
    }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, 'FST_ERR_VALIDATION');
  assert.match(response.json().message, /rate/);
});
