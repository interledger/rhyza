'use strict';

import assert from 'node:assert';
import { describe, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import {
  createResolveStreamCredentials,
  createStreamServer,
  parseStreamServerSecret,
  requireStreamServerSecret
} from '../src/resolve-stream-credentials.js';

describe('createResolveStreamCredentials', () => {
  test('round-trips paymentIntentId and sharedSecret from generateCredentials', async () => {
    const serverSecret = randomBytes(32);
    const serverAddress = 'test.rhyza';
    const streamServer = createStreamServer({ serverSecret, serverAddress });
    const resolveStreamCredentials = createResolveStreamCredentials({
      streamServer,
      serverSecret,
      serverAddress
    });

    const credentials = streamServer.generateCredentials({
      paymentTag: 'intent-abc',
      asset: { code: 'USD', scale: 2 }
    });

    const resolved = await resolveStreamCredentials(credentials.ilpAddress);

    assert.ok(resolved);
    assert.equal(resolved!.paymentIntentId, 'intent-abc');
    assert.ok(resolved!.sharedSecret.equals(credentials.sharedSecret));
  });

  test('returns undefined for an address under a different server prefix', async () => {
    const serverSecret = randomBytes(32);
    const streamServer = createStreamServer({
      serverSecret,
      serverAddress: 'test.rhyza'
    });
    const resolveStreamCredentials = createResolveStreamCredentials({
      streamServer,
      serverSecret,
      serverAddress: 'test.rhyza'
    });

    const resolved = await resolveStreamCredentials('other.prefix.notours');
    assert.equal(resolved, undefined);
  });

  test('parseStreamServerSecret accepts a 32-byte base64url secret', () => {
    const raw = randomBytes(32).toString('base64url');
    assert.equal(parseStreamServerSecret(raw).byteLength, 32);
  });

  test('parseStreamServerSecret rejects wrong length', () => {
    assert.throws(
      () => parseStreamServerSecret(Buffer.from('short').toString('base64url')),
      /32 bytes/
    );
  });

  test('requireStreamServerSecret refuses to start when unset', () => {
    assert.throws(() => requireStreamServerSecret(undefined), /not set/);
  });

  test('requireStreamServerSecret parses a valid secret', () => {
    const raw = randomBytes(32).toString('base64url');
    assert.equal(requireStreamServerSecret(raw).byteLength, 32);
  });
});
