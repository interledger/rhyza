'use strict';

import assert from 'node:assert';
import { describe, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import {
  createStreamServer,
  generateStreamCredentials,
  parseStreamServerSecret,
  requireStreamServerSecret
} from '../src/stream-credentials.js';

describe('stream credentials', () => {
  test('generateStreamCredentials returns address tagged with paymentIntentId and base64url secret', () => {
    const streamServer = createStreamServer({
      serverSecret: randomBytes(32),
      serverAddress: 'test.rhyza'
    });

    const result = generateStreamCredentials(streamServer, {
      paymentIntentId: 'intent-abc',
      assetCode: 'USD',
      assetScale: 2
    });

    assert.equal(
      streamServer.decodePaymentTag(result.ilpAddress),
      'intent-abc'
    );
    assert.match(result.ilpAddress, /^test\.rhyza\./);
    assert.equal(Buffer.from(result.sharedSecret, 'base64url').byteLength, 32);
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
