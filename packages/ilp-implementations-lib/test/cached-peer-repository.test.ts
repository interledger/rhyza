'use strict';

import assert from 'node:assert';
import { describe, test } from 'node:test';
import { ConsoleLogger, ICache } from 'common-types-lib';
import { IPacketCorrelation, IPeer } from 'ilp-domain-lib';
import { InMemoryPeerRepository } from '../src/in-memory-peer-repository';
import { CachedPeerRepository } from '../src/cached-peer-repository';

class MapCache implements ICache<IPacketCorrelation> {
  readonly values = new Map<string, IPacketCorrelation>();
  readonly ttls = new Map<string, number>();
  throwOnSet = false;
  throwOnGet = false;

  async get(key: string): Promise<IPacketCorrelation | undefined> {
    if (this.throwOnGet) {
      throw new Error('cache get failed');
    }
    return this.values.get(key);
  }

  async getKeyExpiry(key: string): Promise<number | undefined> {
    return this.ttls.get(key);
  }

  async set(key: string, value: IPacketCorrelation): Promise<boolean> {
    return this.setWithTtl(key, value, 1);
  }

  async setWithTtl(
    key: string,
    value: IPacketCorrelation,
    ttlMs: number
  ): Promise<boolean> {
    if (this.throwOnSet) {
      throw new Error('cache set failed');
    }
    this.values.set(key, value);
    this.ttls.set(key, ttlMs);
    return true;
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
    this.ttls.delete(key);
  }
}

const packet = (): IPacketCorrelation => ({
  kind: 'QUOTE',
  state: 'PENDING',
  packetId: 'packet-1',
  peerId: 'peer-1',
  paymentIntentId: 'intent-1',
  expiresAt: new Date(Date.now() + 30_000),
  quoteId: 'packet-1',
  requestId: 'req-1',
  inboundPrepare: {
    destinationIlpAddress: 'g.us.alice',
    amount: '100',
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    executionCondition: Buffer.alloc(32).toString('base64'),
    data: Buffer.alloc(0).toString('base64')
  }
});

const peer: IPeer = {
  peerId: 'peer-1',
  http: {
    outgoing: {
      endpoint: 'https://peer.example/ilp',
      callbackEndpoint: 'https://peer.example/ilp/callback',
      authToken: 't'
    }
  }
};

describe('CachedPeerRepository', () => {
  test('storePacket writes Mongo first, then the cache', async () => {
    const inner = new InMemoryPeerRepository();
    const cache = new MapCache();
    const repo = new CachedPeerRepository(inner, new ConsoleLogger(), cache);

    await repo.storePacket(packet());

    assert.ok(await inner.fetchPacketById('packet-1'));
    assert.ok(cache.values.has('ilp:packet:packet-1'));
    const ttl = cache.ttls.get('ilp:packet:packet-1');
    assert.ok(ttl !== undefined && ttl <= 30_000);
    assert.ok(ttl! > 1_000);
  });

  test('a failed cache update drops the stale row so the next read hits Mongo', async () => {
    const inner = new InMemoryPeerRepository();
    const cache = new MapCache();
    const repo = new CachedPeerRepository(inner, new ConsoleLogger(), cache);
    const pending = {
      ...packet(),
      sharedSecret: 'secret-should-not-survive'
    };
    await repo.storePacket(pending);
    assert.equal((await repo.fetchPacketById('packet-1'))?.state, 'PENDING');

    cache.throwOnSet = true;
    await repo.updatePacket({
      ...pending,
      state: 'REJECTED',
      sharedSecret: undefined
    });
    cache.throwOnSet = false;

    const fetched = await repo.fetchPacketById('packet-1');
    assert.equal(fetched?.state, 'REJECTED');
    assert.equal(fetched?.sharedSecret, undefined);
    assert.equal(cache.values.get('ilp:packet:packet-1')?.state, 'REJECTED');
  });

  test('a cache write failure does not fail the Mongo write', async () => {
    const inner = new InMemoryPeerRepository();
    const cache = new MapCache();
    cache.throwOnSet = true;
    const repo = new CachedPeerRepository(inner, new ConsoleLogger(), cache);

    await repo.storePacket(packet());

    assert.ok(await inner.fetchPacketById('packet-1'));
    assert.equal(cache.values.size, 0);
  });

  test('fetchPacketById returns the cached row without reading Mongo', async () => {
    const inner = new InMemoryPeerRepository();
    const cache = new MapCache();
    const repo = new CachedPeerRepository(inner, new ConsoleLogger(), cache);
    const stored = packet();
    await cache.setWithTtl('ilp:packet:packet-1', stored, 60_000);

    const fetched = await repo.fetchPacketById('packet-1');
    assert.equal(fetched?.packetId, 'packet-1');
    assert.equal(await inner.fetchPacketById('packet-1'), undefined);
  });

  test('a cache miss loads Mongo and backfills Redis', async () => {
    const inner = new InMemoryPeerRepository();
    const cache = new MapCache();
    const repo = new CachedPeerRepository(inner, new ConsoleLogger(), cache);
    await inner.storePacket(packet());

    const fetched = await repo.fetchPacketById('packet-1');
    assert.equal(fetched?.packetId, 'packet-1');
    assert.ok(cache.values.has('ilp:packet:packet-1'));
  });

  test('a cache read failure falls back to Mongo', async () => {
    const inner = new InMemoryPeerRepository();
    const cache = new MapCache();
    cache.throwOnGet = true;
    const repo = new CachedPeerRepository(inner, new ConsoleLogger(), cache);
    await inner.storePacket(packet());

    const fetched = await repo.fetchPacketById('packet-1');
    assert.equal(fetched?.packetId, 'packet-1');
  });

  test('peer config is not cached', async () => {
    const inner = new InMemoryPeerRepository();
    const cache = new MapCache();
    const repo = new CachedPeerRepository(inner, new ConsoleLogger(), cache);

    await repo.store(peer);
    const fetched = await repo.fetchById('peer-1');
    assert.equal(fetched?.peerId, 'peer-1');
    assert.equal(cache.values.size, 0);
  });

  test('without a cache, packets go straight to the store', async () => {
    const inner = new InMemoryPeerRepository();
    const repo = new CachedPeerRepository(inner, new ConsoleLogger());

    await repo.storePacket(packet());
    const fetched = await repo.fetchPacketById('packet-1');
    assert.equal(fetched?.packetId, 'packet-1');
  });
});
