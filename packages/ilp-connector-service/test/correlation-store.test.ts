'use strict';

import assert from 'node:assert';
import { describe, test } from 'node:test';
import { InMemoryTransportCorrelationStore } from '../src/correlation/in-memory-store';

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

  test('claimExpiredOutbound returns due packetIds and leaves future ones scheduled', async () => {
    const store = new InMemoryTransportCorrelationStore();
    await store.scheduleOutboundExpiry(
      'due',
      new Date(Date.now() - 1_000).toISOString()
    );
    await store.scheduleOutboundExpiry(
      'future',
      new Date(Date.now() + 60_000).toISOString()
    );

    const claimed = await store.claimExpiredOutbound();
    assert.deepEqual(claimed, ['due']);

    assert.deepEqual(await store.claimExpiredOutbound(), []);
  });
});
