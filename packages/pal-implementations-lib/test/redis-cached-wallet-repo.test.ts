'use strict';

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { ConsoleLogger, ICache } from 'common-types-lib';
import {
  IPalWalletAddressRepository,
  IPalWalletAddressWithKeysDto
} from 'pal-domain-lib';
import {
  IPalWalletAddressDto,
  IPalWalletAddressKeyDto
} from 'pal-public-types-lib';
import { RedisCachedWalletAddressRepo } from '../src/redis/redis-cached-wallet-repo';

const TTL_MS = 60_000;

// Stores values as JSON, like RedisCache, so Dates come back as strings.
class MapCache<T> implements ICache<T> {
  readonly values = new Map<string, string>();
  readonly ttls = new Map<string, number>();
  throwOnGet = false;
  throwOnSet = false;
  throwOnDelete = false;

  async get(key: string): Promise<T | undefined> {
    if (this.throwOnGet) {
      throw new Error('cache get failed');
    }
    const value = this.values.get(key);
    return value === undefined ? undefined : (JSON.parse(value) as T);
  }

  async getKeyExpiry(key: string): Promise<number | undefined> {
    return this.ttls.get(key);
  }

  async set(key: string, value: T): Promise<boolean> {
    return this.setWithTtl(key, value, Infinity);
  }

  async setWithTtl(key: string, value: T, ttlMs: number): Promise<boolean> {
    if (this.throwOnSet) {
      throw new Error('cache set failed');
    }
    this.values.set(key, JSON.stringify(value));
    this.ttls.set(key, ttlMs);
    return true;
  }

  async delete(key: string): Promise<void> {
    if (this.throwOnDelete) {
      throw new Error('cache delete failed');
    }
    this.values.delete(key);
    this.ttls.delete(key);
  }
}

// Stands in for MongoDbWalletRepo and counts the calls that reach it.
class CountingWalletRepo implements IPalWalletAddressRepository {
  readonly wallets = new Map<string, IPalWalletAddressDto>();
  readonly keys = new Map<string, IPalWalletAddressKeyDto[]>();
  readonly fetchCalls: string[][] = [];
  readonly fetchWithKeysCalls: string[] = [];
  readonly getByAliasCalls: [string | null, string][] = [];

  async store(walletAddress: IPalWalletAddressDto): Promise<void> {
    this.wallets.set(walletAddress.id, structuredClone(walletAddress));
  }

  async storeKey(key: IPalWalletAddressKeyDto): Promise<void> {
    const existing = (this.keys.get(key.walletAddressId) ?? []).filter(
      (stored) => stored.id !== key.id
    );
    this.keys.set(key.walletAddressId, [...existing, structuredClone(key)]);
  }

  async fetch(ids: string[]): Promise<IPalWalletAddressDto[]> {
    this.fetchCalls.push([...ids]);
    return ids
      .map((id) => this.wallets.get(id))
      .filter((wallet) => wallet !== undefined)
      .map((wallet) => structuredClone(wallet));
  }

  async fetchWithKeys(
    id: string
  ): Promise<IPalWalletAddressWithKeysDto | null> {
    this.fetchWithKeysCalls.push(id);
    const wallet = this.wallets.get(id);
    if (!wallet) {
      return null;
    }
    return {
      ...structuredClone(wallet),
      keys: structuredClone(this.keys.get(id) ?? [])
    };
  }

  async getByAlias(
    domain: string | null,
    pathName: string
  ): Promise<IPalWalletAddressDto | null> {
    this.getByAliasCalls.push([domain, pathName]);
    for (const wallet of this.wallets.values()) {
      if (
        wallet.aliases.some(
          (alias) => alias.domain === domain && alias.pathName === pathName
        )
      ) {
        return structuredClone(wallet);
      }
    }
    return null;
  }
}

const wallet = (
  id: string,
  pathName: string = id,
  domain: string | null = null
): IPalWalletAddressDto => ({
  id,
  publicName: `Wallet ${id}`,
  assetCode: 'USD',
  assetScale: 2,
  isActive: true,
  aliases: [{ domain, pathName, walletId: id }]
});

const key = (
  id: string,
  walletAddressId: string,
  revokedAt?: Date
): IPalWalletAddressKeyDto => ({
  id,
  walletAddressId,
  jwk: { kid: `kid-${id}`, alg: 'EdDSA', kty: 'OKP', crv: 'Ed25519', x: 'x' },
  revoked: revokedAt !== undefined,
  ...(revokedAt ? { revokedAt } : {})
});

describe('RedisCachedWalletAddressRepo', () => {
  let inner: CountingWalletRepo;
  let walletCache: MapCache<IPalWalletAddressDto>;
  let aliasCache: MapCache<string>;
  let keyCache: MapCache<IPalWalletAddressKeyDto[]>;
  let repo: RedisCachedWalletAddressRepo;

  beforeEach(() => {
    inner = new CountingWalletRepo();
    walletCache = new MapCache();
    aliasCache = new MapCache();
    keyCache = new MapCache();
    repo = new RedisCachedWalletAddressRepo(
      inner,
      { wallets: walletCache, aliases: aliasCache, keys: keyCache },
      TTL_MS,
      new ConsoleLogger()
    );
  });

  describe('fetch', () => {
    test('a miss loads Mongo and caches the wallet by id with the TTL', async () => {
      await inner.store(wallet('w1'));

      const [fetched] = await repo.fetch(['w1']);

      assert.deepEqual(fetched, wallet('w1'));
      assert.deepEqual(inner.fetchCalls, [['w1']]);
      assert.ok(walletCache.values.has('pal:wallet:w1'));
      assert.equal(walletCache.ttls.get('pal:wallet:w1'), TTL_MS);
    });

    test('a hit is served from the cache without reading Mongo', async () => {
      await inner.store(wallet('w1'));
      await repo.fetch(['w1']);

      const [fetched] = await repo.fetch(['w1']);

      assert.deepEqual(fetched, wallet('w1'));
      assert.equal(inner.fetchCalls.length, 1);
    });

    test('a batch only reads the ids that are not cached', async () => {
      await inner.store(wallet('w1'));
      await inner.store(wallet('w2'));
      await inner.store(wallet('w3'));
      await repo.fetch(['w1', 'w3']);

      const fetched = await repo.fetch(['w1', 'w2', 'w3']);

      assert.deepEqual(
        fetched.map((found) => found.id),
        ['w1', 'w2', 'w3']
      );
      assert.deepEqual(inner.fetchCalls.at(-1), ['w2']);
    });

    test('a fully cached batch does not read Mongo', async () => {
      await inner.store(wallet('w1'));
      await inner.store(wallet('w2'));
      await repo.fetch(['w1', 'w2']);

      await repo.fetch(['w2', 'w1']);

      assert.equal(inner.fetchCalls.length, 1);
    });

    test('a wallet that does not exist is not cached', async () => {
      const fetched = await repo.fetch(['missing']);

      assert.deepEqual(fetched, []);
      assert.equal(walletCache.values.size, 0);

      await repo.fetch(['missing']);
      assert.equal(inner.fetchCalls.length, 2);
    });

    test('does not cache keys with the wallet', async () => {
      await inner.store({ ...wallet('w1'), keys: [key('k1', 'w1')] });

      await repo.fetch(['w1']);

      const cached = await walletCache.get('pal:wallet:w1');
      assert.equal(cached?.keys, undefined);
    });

    test('a cache read failure falls back to Mongo', async () => {
      await inner.store(wallet('w1'));
      walletCache.throwOnGet = true;

      const [fetched] = await repo.fetch(['w1']);

      assert.equal(fetched?.id, 'w1');
      assert.deepEqual(inner.fetchCalls, [['w1']]);
    });

    test('a cache write failure does not fail the read', async () => {
      await inner.store(wallet('w1'));
      walletCache.throwOnSet = true;

      const [fetched] = await repo.fetch(['w1']);

      assert.equal(fetched?.id, 'w1');
    });
  });

  describe('getByAlias', () => {
    test('a miss loads Mongo and caches alias to wallet id, plus the wallet', async () => {
      await inner.store(wallet('w1', 'alice', 'example.com'));

      const found = await repo.getByAlias('example.com', 'alice');

      assert.equal(found?.id, 'w1');
      assert.equal(aliasCache.values.size, 1);
      const [[aliasKey, aliasValue]] = [...aliasCache.values.entries()];
      assert.ok(aliasKey.startsWith('pal:wallet-alias:'));
      assert.equal(JSON.parse(aliasValue), 'w1');
      assert.equal(aliasCache.ttls.get(aliasKey), TTL_MS);
      assert.ok(walletCache.values.has('pal:wallet:w1'));
    });

    test('a hit goes through the id cache without reading Mongo', async () => {
      await inner.store(wallet('w1', 'alice', 'example.com'));
      await repo.getByAlias('example.com', 'alice');

      const found = await repo.getByAlias('example.com', 'alice');

      assert.deepEqual(found, wallet('w1', 'alice', 'example.com'));
      assert.equal(inner.getByAliasCalls.length, 1);
      assert.equal(inner.fetchCalls.length, 0);
    });

    test('a hit whose wallet entry was evicted reloads only the wallet by id', async () => {
      await inner.store(wallet('w1', 'alice'));
      await repo.getByAlias(null, 'alice');
      await walletCache.delete('pal:wallet:w1');

      const found = await repo.getByAlias(null, 'alice');

      assert.equal(found?.id, 'w1');
      assert.equal(inner.getByAliasCalls.length, 1);
      assert.deepEqual(inner.fetchCalls, [['w1']]);
    });

    test('a free alias is not cached, so it stays free after it is taken', async () => {
      assert.equal(await repo.getByAlias(null, 'alice'), null);
      assert.equal(aliasCache.values.size, 0);

      await repo.store(wallet('w1', 'alice'));

      const found = await repo.getByAlias(null, 'alice');
      assert.equal(found?.id, 'w1');
    });

    test('keeps a null domain apart from other domains', async () => {
      await inner.store(wallet('w1', 'alice', null));
      await inner.store(wallet('w2', 'alice', 'example.com'));

      assert.equal((await repo.getByAlias(null, 'alice'))?.id, 'w1');
      assert.equal((await repo.getByAlias('example.com', 'alice'))?.id, 'w2');
      assert.equal((await repo.getByAlias(null, 'alice'))?.id, 'w1');
      assert.equal((await repo.getByAlias('example.com', 'alice'))?.id, 'w2');
    });

    test('does not mix up aliases whose parts contain the separator', async () => {
      await inner.store(wallet('w1', 'b:c', 'a'));
      await inner.store(wallet('w2', 'c', 'a:b'));

      assert.equal((await repo.getByAlias('a', 'b:c'))?.id, 'w1');
      assert.equal((await repo.getByAlias('a:b', 'c'))?.id, 'w2');
      assert.equal((await repo.getByAlias('a', 'b:c'))?.id, 'w1');
    });

    test('a cached mapping to a wallet that no longer has the alias falls back to Mongo', async () => {
      await inner.store(wallet('w1', 'alice'));
      await repo.getByAlias(null, 'alice');

      // the alias now belongs to another wallet, and w1's entry is refreshed
      await repo.store(wallet('w1', 'bob'));
      await repo.store(wallet('w2', 'alice'));

      const found = await repo.getByAlias(null, 'alice');
      assert.equal(found?.id, 'w2');
      assert.equal(inner.getByAliasCalls.length, 2);
    });

    test('a cache read failure falls back to Mongo', async () => {
      await inner.store(wallet('w1', 'alice'));
      aliasCache.throwOnGet = true;

      const found = await repo.getByAlias(null, 'alice');

      assert.equal(found?.id, 'w1');
      assert.equal(inner.getByAliasCalls.length, 1);
    });
  });

  describe('fetchWithKeys', () => {
    test('a miss loads Mongo and caches the keys and the wallet separately', async () => {
      await inner.store(wallet('w1'));
      await inner.storeKey(key('k1', 'w1'));

      const found = await repo.fetchWithKeys('w1');

      assert.deepEqual(found, { ...wallet('w1'), keys: [key('k1', 'w1')] });
      assert.ok(keyCache.values.has('pal:wallet-keys:w1'));
      assert.equal(keyCache.ttls.get('pal:wallet-keys:w1'), TTL_MS);
      const cachedWallet = await walletCache.get('pal:wallet:w1');
      assert.deepEqual(cachedWallet, wallet('w1'));
    });

    test('a hit combines the cached keys with the cached wallet without reading Mongo', async () => {
      await inner.store(wallet('w1'));
      await inner.storeKey(key('k1', 'w1'));
      await repo.fetchWithKeys('w1');

      const found = await repo.fetchWithKeys('w1');

      assert.deepEqual(found, { ...wallet('w1'), keys: [key('k1', 'w1')] });
      assert.equal(inner.fetchWithKeysCalls.length, 1);
      assert.equal(inner.fetchCalls.length, 0);
    });

    test('cached keys are combined with a wallet loaded by id when only the wallet was evicted', async () => {
      await inner.store(wallet('w1'));
      await inner.storeKey(key('k1', 'w1'));
      await repo.fetchWithKeys('w1');
      await repo.store({ ...wallet('w1'), isActive: false });

      const found = await repo.fetchWithKeys('w1');

      assert.equal(found?.isActive, false);
      assert.deepEqual(found?.keys, [key('k1', 'w1')]);
      assert.equal(inner.fetchWithKeysCalls.length, 1);
      assert.deepEqual(inner.fetchCalls, [['w1']]);
    });

    test('caches an empty key list', async () => {
      await inner.store(wallet('w1'));
      await repo.fetchWithKeys('w1');

      const found = await repo.fetchWithKeys('w1');

      assert.deepEqual(found?.keys, []);
      assert.equal(inner.fetchWithKeysCalls.length, 1);
    });

    test('restores revokedAt as a Date from the cache', async () => {
      const revokedAt = new Date('2026-01-02T03:04:05.000Z');
      await inner.store(wallet('w1'));
      await inner.storeKey(key('k1', 'w1', revokedAt));
      await repo.fetchWithKeys('w1');

      const found = await repo.fetchWithKeys('w1');

      assert.ok(found?.keys[0].revokedAt instanceof Date);
      assert.equal(found?.keys[0].revokedAt?.getTime(), revokedAt.getTime());
    });

    test('a wallet that does not exist returns null and is not cached', async () => {
      assert.equal(await repo.fetchWithKeys('missing'), null);
      assert.equal(keyCache.values.size, 0);
      assert.equal(walletCache.values.size, 0);
    });
  });

  describe('store and storeKey', () => {
    test('store writes Mongo, then evicts the wallet entry', async () => {
      await inner.store(wallet('w1'));
      await repo.fetch(['w1']);

      await repo.store({ ...wallet('w1'), isActive: false });

      assert.equal(inner.wallets.get('w1')?.isActive, false);
      assert.equal(walletCache.values.has('pal:wallet:w1'), false);
      const [fetched] = await repo.fetch(['w1']);
      assert.equal(fetched?.isActive, false);
    });

    test('store leaves the keys entry alone', async () => {
      await inner.store(wallet('w1'));
      await repo.fetchWithKeys('w1');

      await repo.store({ ...wallet('w1'), publicName: 'Renamed' });

      assert.ok(keyCache.values.has('pal:wallet-keys:w1'));
    });

    test('storeKey writes Mongo, then evicts the keys entry', async () => {
      await inner.store(wallet('w1'));
      await repo.fetchWithKeys('w1');

      await repo.storeKey(key('k1', 'w1'));

      assert.equal(keyCache.values.has('pal:wallet-keys:w1'), false);
      assert.ok(walletCache.values.has('pal:wallet:w1'));
      const found = await repo.fetchWithKeys('w1');
      assert.deepEqual(found?.keys, [key('k1', 'w1')]);
    });

    test('a failed Mongo write does not evict the cache', async () => {
      await inner.store(wallet('w1'));
      await repo.fetchWithKeys('w1');
      inner.store = async () => {
        throw new Error('mongo down');
      };
      inner.storeKey = async () => {
        throw new Error('mongo down');
      };

      await assert.rejects(repo.store(wallet('w1')), /mongo down/);
      await assert.rejects(repo.storeKey(key('k1', 'w1')), /mongo down/);
      assert.ok(walletCache.values.has('pal:wallet:w1'));
      assert.ok(keyCache.values.has('pal:wallet-keys:w1'));
    });

    test('a failed eviction does not fail the write', async () => {
      await inner.store(wallet('w1'));
      walletCache.throwOnDelete = true;
      keyCache.throwOnDelete = true;

      await repo.store({ ...wallet('w1'), isActive: false });
      await repo.storeKey(key('k1', 'w1'));

      assert.equal(inner.wallets.get('w1')?.isActive, false);
      assert.equal(inner.keys.get('w1')?.length, 1);
    });
  });
});
