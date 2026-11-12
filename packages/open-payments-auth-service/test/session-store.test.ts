import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import { AuthClient } from 'auth-client-lib';
import { ICache } from 'common-types-lib';
import { interactionRoutes } from '../src/routes/interaction';
import { CacheSessionStore } from '../src/session-store';

const GRANT_ID = '6a1f2c3d-0000-4000-8000-000000000001';
const NONCE = 'nonce-1';
const TTL_MS = 600_000;

// Round-trips values through JSON like RedisCache, and records each TTL
class FakeCache<T> implements ICache<T> {
  entries = new Map<string, { value: string; ttlMs?: number }>();

  async get(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    return entry ? (JSON.parse(entry.value) as T) : undefined;
  }

  async getKeyExpiry(): Promise<number | undefined> {
    return undefined;
  }

  async set(key: string, value: T): Promise<boolean> {
    this.entries.set(key, { value: JSON.stringify(value) });
    return true;
  }

  async setWithTtl(key: string, value: T, ttlMs: number): Promise<boolean> {
    this.entries.set(key, { value: JSON.stringify(value), ttlMs });
    return true;
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }
}

describe('interaction session store', () => {
  let app: FastifyInstance;
  let cache: FakeCache<never>;
  let finished: string[];

  beforeEach(async () => {
    cache = new FakeCache();
    finished = [];
    app = Fastify();
    app.register(fastifyCookie);
    app.register(fastifySession, {
      cookieName: 'interactionSessionId',
      secret: 'a-test-secret-that-is-at-least-32-characters',
      store: new CacheSessionStore(cache, TTL_MS),
      saveUninitialized: false,
      cookie: { secure: false, maxAge: TTL_MS }
    });
    await app.register(interactionRoutes, {
      authClient: {
        startInteraction: async (grantId: string) => ({
          id: grantId,
          nonce: NONCE,
          clientUri: 'https://client.example',
          clientName: 'Client'
        }),
        getGrant: async () => ({ interactionNonce: NONCE }),
        finishInteraction: async (grantId: string) => {
          finished.push(grantId);
          return {};
        }
      } as unknown as AuthClient,
      openPaymentsAuthServerUrl: 'https://auth.example',
      idpUrl: 'https://idp.example/consent'
    });
  });

  async function startInteraction(): Promise<string> {
    const response = await app.inject({
      method: 'GET',
      url: `/interaction/${GRANT_ID}/start`
    });
    assert.equal(response.statusCode, 302);
    const cookie = response.cookies.find(
      (c) => c.name === 'interactionSessionId'
    );
    assert.ok(cookie, 'session cookie is set');
    return `${cookie.name}=${cookie.value}`;
  }

  function finishInteraction(cookie?: string) {
    return app.inject({
      method: 'POST',
      url: `/interaction/${GRANT_ID}/finish`,
      headers: cookie ? { cookie } : {}
    });
  }

  test('start stores the session in the cache with the TTL', async () => {
    await startInteraction();

    assert.equal(cache.entries.size, 1);
    const [[key, entry]] = [...cache.entries];
    assert.match(key, /^op-auth:session:/);
    assert.equal(entry.ttlMs, TTL_MS);
    assert.equal(JSON.parse(entry.value).interactionSessionId, NONCE);
  });

  test('finish succeeds while the session is in the cache', async () => {
    const cookie = await startInteraction();

    const response = await finishInteraction(cookie);

    assert.equal(response.statusCode, 202);
    assert.deepEqual(finished, [GRANT_ID]);
  });

  test('finish is rejected once the session is gone from the cache', async () => {
    const cookie = await startInteraction();
    cache.entries.clear(); // what a TTL expiry looks like to the store

    const response = await finishInteraction(cookie);

    assert.equal(response.statusCode, 401);
    assert.deepEqual(finished, []);
  });

  test('finish is rejected without a session cookie', async () => {
    const response = await finishInteraction();

    assert.equal(response.statusCode, 401);
    assert.deepEqual(finished, []);
  });

  test('requests that do not touch the session are not stored', async () => {
    await finishInteraction();

    assert.equal(cache.entries.size, 0);
  });
});
