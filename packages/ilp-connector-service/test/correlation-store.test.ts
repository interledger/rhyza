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
});
