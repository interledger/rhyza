'use strict';

import assert from 'node:assert';
import { describe, test } from 'node:test';
import { IMessage } from 'common-types-lib';
import { ILPPeerCreatedEvent, ILPPeerUpdatedEvent } from 'ilp-domain-lib';
import { PeerDirectory } from '../src/peer-directory';

const HTTP = {
  outgoing: {
    endpoint: 'http://peer.example/ilp',
    callbackEndpoint: 'http://peer.example/ilp/callback',
    authToken: 'out-token'
  },
  incoming: { authToken: 'in-token' }
};

describe('PeerDirectory', () => {
  test('upserts from an ILPPeerCreatedEvent and resolves outgoing config', () => {
    const directory = new PeerDirectory();
    directory.upsertFromEvent(
      new ILPPeerCreatedEvent({ peerId: 'peer-1', http: HTTP, isActive: true })
    );

    assert.deepEqual(directory.getOutgoing('peer-1'), HTTP.outgoing);
    assert.equal(directory.isActive('peer-1'), true);
    assert.equal(directory.resolvePeerIdByIncomingToken('in-token'), 'peer-1');
    assert.equal(
      directory.resolvePeerIdByIncomingToken('wrong-token'),
      undefined
    );
  });

  test('an ILPPeerUpdatedEvent overwrites the previous config', () => {
    const directory = new PeerDirectory();
    directory.upsertFromEvent(
      new ILPPeerCreatedEvent({ peerId: 'peer-1', http: HTTP, isActive: true })
    );
    directory.upsertFromEvent(
      new ILPPeerUpdatedEvent({
        peerId: 'peer-1',
        http: {
          outgoing: {
            endpoint: 'http://peer.example/ilp',
            callbackEndpoint: 'http://peer.example/ilp/callback',
            authToken: 'out-token-2'
          }
        },
        isActive: false
      })
    );

    assert.equal(
      directory.getOutgoing('peer-1')?.endpoint,
      'http://peer.example/ilp'
    );
    assert.equal(directory.isActive('peer-1'), false);
    // the old incoming token from the create event is gone - update replaced
    // the whole record, it didn't merge.
    assert.equal(directory.resolvePeerIdByIncomingToken('in-token'), undefined);
  });

  test('an unrelated event is ignored', () => {
    const directory = new PeerDirectory();
    directory.upsertFromEvent({
      msgName: 'SomethingElse',
      payload: {}
    } as unknown as IMessage);
    assert.equal(directory.size, 0);
  });

  test('an unknown peer has no outgoing config', () => {
    const directory = new PeerDirectory();
    assert.equal(directory.getOutgoing('peer-unknown'), undefined);
    assert.equal(
      directory.resolvePeerIdByIncomingToken('any-token'),
      undefined
    );
  });
});
