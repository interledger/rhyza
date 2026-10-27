'use strict';

import assert from 'node:assert';
import { describe, test } from 'node:test';
import { InvalidHTTPEndpoint, Peer } from '../src/peer';

const validHttp = {
  outgoing: {
    endpoint: 'https://peer.example/ilp',
    callbackEndpoint: 'https://peer.example/ilp/callback',
    authToken: 'token'
  }
};

describe('Peer HTTP config', () => {
  test('create requires a callback endpoint distinct from the prepare endpoint', () => {
    const peer = Peer.create({ peerId: 'peer-1', http: validHttp });
    assert.equal(
      peer.http.outgoing.callbackEndpoint,
      'https://peer.example/ilp/callback'
    );
  });

  test('a missing callback endpoint is rejected', () => {
    assert.throws(
      () =>
        Peer.create({
          peerId: 'peer-1',
          http: {
            outgoing: {
              endpoint: 'https://peer.example/ilp',
              callbackEndpoint: '',
              authToken: 'token'
            }
          }
        }),
      InvalidHTTPEndpoint
    );
  });

  test('an invalid callback endpoint is rejected', () => {
    assert.throws(
      () =>
        Peer.create({
          peerId: 'peer-1',
          http: {
            outgoing: {
              endpoint: 'https://peer.example/ilp',
              callbackEndpoint: 'not-a-url',
              authToken: 'token'
            }
          }
        }),
      InvalidHTTPEndpoint
    );
  });
});
