'use strict';

import assert from 'node:assert';
import { describe, test } from 'node:test';
import { InMemoryTransportCorrelationStore } from '../src/correlation/in-memory-store';
import { outboundCorrelationTtlMs } from '../src/correlation/expiry';

// The aggregate does not clock-check replies, so this TTL alone keeps a reply
// that arrives after expiresAt from being applied.
describe('outboundCorrelationTtlMs', () => {
  test('an outbound correlation lives until expiresAt and no longer', () => {
    const ttl = outboundCorrelationTtlMs(
      new Date(Date.now() + 10_000).toISOString()
    );
    assert.ok(ttl <= 10_000, `expected no grace past expiresAt, got ${ttl}ms`);
    assert.ok(
      ttl > 9_000,
      `expected the time left until expiresAt, got ${ttl}ms`
    );
  });

  test('an already expired packet gets the minimum TTL', () => {
    assert.equal(
      outboundCorrelationTtlMs(new Date(Date.now() - 1_000).toISOString()),
      1
    );
  });
});

describe('InMemoryTransportCorrelationStore', () => {
  test('outbound correlations are taken exactly once across replicas', async () => {
    const store = new InMemoryTransportCorrelationStore();
    await store.storeOutboundCorrelation('packet-1', {
      peerId: 'peer-1',
      paymentIntentId: 'intent-1',
      expiresAt: new Date(Date.now() + 30_000).toISOString()
    });

    const first = await store.takeOutboundCorrelation('packet-1');
    assert.equal(first?.paymentIntentId, 'intent-1');

    const second = await store.takeOutboundCorrelation('packet-1');
    assert.equal(second, undefined);
  });
});
