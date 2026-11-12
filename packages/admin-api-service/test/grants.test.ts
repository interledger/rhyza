import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { AuthClient, IPageQuery } from 'auth-client-lib';
import { grantRoutes } from '../src/routes/grants.js';
import { MAX_GRANT_WALLET_ADDRESSES } from '../src/pagination.js';

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

/** Captures the page query the route hands to the auth client. */
function appWithGrantsPageSpy(): {
  app: ReturnType<typeof Fastify>;
  queries: IPageQuery[];
} {
  const queries: IPageQuery[] = [];
  const app = Fastify();
  app.register(grantRoutes, {
    authClient: {
      getGrantsPage: async (query: IPageQuery) => {
        queries.push(query);
        return {
          items: [],
          pagination: { hasNextPage: false, hasPreviousPage: false }
        };
      }
    } as unknown as AuthClient
  });
  return { app, queries };
}

test('GET /grants filters by a single wallet address', async () => {
  const { app, queries } = appWithGrantsPageSpy();

  const response = await app.inject({
    method: 'GET',
    url: '/grants?walletAddress=https://test.com/alice'
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(queries[0].identifiers, ['https://test.com/alice']);
});

test('GET /grants filters by several wallet addresses', async () => {
  const { app, queries } = appWithGrantsPageSpy();

  const response = await app.inject({
    method: 'GET',
    url: '/grants?walletAddress=https://test.com/alice&walletAddress=https://test.com/bob'
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(queries[0].identifiers, [
    'https://test.com/alice',
    'https://test.com/bob'
  ]);
});

test('GET /grants without the filter lists across all wallet addresses', async () => {
  const { app, queries } = appWithGrantsPageSpy();

  const response = await app.inject({ method: 'GET', url: '/grants' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(queries[0].identifiers, []);
});

test('GET /grants rejects more wallet addresses than the filter allows', async () => {
  const { app, queries } = appWithGrantsPageSpy();
  const tooMany = Array.from(
    { length: MAX_GRANT_WALLET_ADDRESSES + 1 },
    (_, i) => `walletAddress=https://test.com/${i}`
  ).join('&');

  const response = await app.inject({
    method: 'GET',
    url: `/grants?${tooMany}`
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /Too many walletAddress filters: 51/);
  // Rejected at the edge: the filter never reaches the auth service.
  assert.deepEqual(queries, []);
});

test('GET /grants accepts exactly the maximum number of wallet addresses', async () => {
  const { app, queries } = appWithGrantsPageSpy();
  const atLimit = Array.from(
    { length: MAX_GRANT_WALLET_ADDRESSES },
    (_, i) => `walletAddress=https://test.com/${i}`
  ).join('&');

  const response = await app.inject({
    method: 'GET',
    url: `/grants?${atLimit}`
  });

  assert.equal(response.statusCode, 200);
  assert.equal(queries[0].identifiers?.length, MAX_GRANT_WALLET_ADDRESSES);
});
