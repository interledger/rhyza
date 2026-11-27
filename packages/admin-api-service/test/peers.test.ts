import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IlpClient } from 'ilp-client-lib';
import { PalClient } from 'pal-client-lib';
import { peerRoutes } from '../src/routes/peers.js';
import { createTestApp } from './helpers.js';

const peerPayload = {
  id: 'peer-1',
  name: 'Peer One',
  assetCode: 'USD',
  assetScale: 2,
  ilpStaticAddress: 'g.peer.one',
  http: {
    outgoing: {
      endpoint: 'https://peer.example/ilp',
      callbackEndpoint: 'https://rhyza.example/ilp/callback',
      authToken: 'secret'
    }
  }
};

test('POST /peers creates PAL and ILP peer records', async () => {
  const calls: string[] = [];
  const app = createTestApp();
  app.register(peerRoutes, {
    palClient: {
      createPeer: async () => {
        calls.push('pal.create');
      }
    } as unknown as PalClient,
    ilpClient: {
      createPeer: async () => {
        calls.push('ilp.create');
      }
    } as unknown as IlpClient
  });

  const response = await app.inject({
    method: 'POST',
    url: '/peers',
    payload: peerPayload
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json(), { id: 'peer-1' });
  assert.deepEqual(calls, ['pal.create', 'ilp.create']);
});

test('POST /peers deactivates the PAL peer when ILP creation fails', async () => {
  const calls: string[] = [];
  const app = createTestApp();
  app.register(peerRoutes, {
    palClient: {
      createPeer: async () => {
        calls.push('pal.create');
      },
      deactivatePeer: async () => {
        calls.push('pal.deactivate');
      }
    } as unknown as PalClient,
    ilpClient: {
      createPeer: async () => {
        calls.push('ilp.create');
        throw new Error('connector unavailable');
      }
    } as unknown as IlpClient
  });

  const response = await app.inject({
    method: 'POST',
    url: '/peers',
    payload: peerPayload
  });

  assert.equal(response.statusCode, 502);
  assert.match(response.json().error, /connector unavailable/);
  assert.deepEqual(calls, ['pal.create', 'ilp.create', 'pal.deactivate']);
});

test('POST /peers returns 409 without creating ILP config for a duplicate', async () => {
  let ilpCalled = false;
  const app = createTestApp();
  app.register(peerRoutes, {
    palClient: {
      createPeer: async () => {
        throw new Error('Peer already exists');
      }
    } as unknown as PalClient,
    ilpClient: {
      createPeer: async () => {
        ilpCalled = true;
      }
    } as unknown as IlpClient
  });

  const response = await app.inject({
    method: 'POST',
    url: '/peers',
    payload: peerPayload
  });

  assert.equal(response.statusCode, 409);
  assert.equal(ilpCalled, false);
});

test('POST /peers validates required fields', async () => {
  const app = createTestApp();
  app.register(peerRoutes, {
    palClient: {} as PalClient,
    ilpClient: {} as IlpClient
  });

  const response = await app.inject({
    method: 'POST',
    url: '/peers',
    payload: {
      id: peerPayload.id,
      name: peerPayload.name,
      assetCode: peerPayload.assetCode,
      assetScale: peerPayload.assetScale,
      ilpStaticAddress: peerPayload.ilpStaticAddress
    }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, 'FST_ERR_VALIDATION');
  assert.match(response.json().message, /http/);
});
