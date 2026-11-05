import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { AuthClient } from 'auth-client-lib';
import { grantRoutes } from '../src/routes/grants.js';

test('GET /grants/:id returns 404 for an unknown grant', async () => {
  const app = Fastify();
  await app.register(grantRoutes, {
    authClient: {
      getGrant: async () => null
    } as unknown as AuthClient
  });

  const response = await app.inject({
    method: 'GET',
    url: '/grants/00000000-0000-0000-0000-000000000000'
  });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: 'Grant not found' });
});
