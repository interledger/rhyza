'use strict';

import assert from 'node:assert';
import { randomBytes } from 'node:crypto';
import { describe, test } from 'node:test';
import { StreamServer, type IncomingMoney } from '@interledger/stream-receiver';
import { encodeOutgoingStreamPrepare } from '../src/stream/encode.js';

function remoteReceiver() {
  const streamServer = new StreamServer({
    serverSecret: randomBytes(32),
    serverAddress: 'test.receiver'
  });
  const credentials = streamServer.generateCredentials({
    paymentTag: 'intent-1'
  });
  return { streamServer, credentials };
}

function toPrepare(
  destination: string,
  encoded: { executionCondition: Buffer; data: Buffer },
  amount: string
) {
  return {
    destination,
    amount,
    expiresAt: new Date(Date.now() + 30_000),
    executionCondition: encoded.executionCondition,
    data: encoded.data
  };
}

function isIncomingMoney(reply: { accept?: unknown }): reply is IncomingMoney {
  return typeof reply.accept === 'function';
}

describe('STREAM encode vs StreamServer.createReply', () => {
  test('a fulfillable encoded prepare is IncomingMoney', () => {
    const { streamServer, credentials } = remoteReceiver();
    const encoded = encodeOutgoingStreamPrepare({
      sharedSecret: credentials.sharedSecret,
      minDestinationAmount: '100'
    });

    const reply = streamServer.createReply(
      toPrepare(credentials.ilpAddress, encoded, '100')
    );

    assert.ok(isIncomingMoney(reply));
    assert.ok(reply.accept().fulfillment.equals(encoded.fulfillment));
  });

  test('a random condition is F05 (quote probe)', () => {
    const { streamServer, credentials } = remoteReceiver();
    const encoded = encodeOutgoingStreamPrepare({
      sharedSecret: credentials.sharedSecret,
      minDestinationAmount: '0'
    });

    const reply = streamServer.createReply({
      ...toPrepare(credentials.ilpAddress, encoded, '100'),
      executionCondition: randomBytes(32)
    });

    assert.equal(isIncomingMoney(reply), false);
    assert.equal((reply as { code: string }).code, 'F05');
  });

  test('undecryptable data is F06 without throwing', () => {
    const { streamServer, credentials } = remoteReceiver();
    const encoded = encodeOutgoingStreamPrepare({
      sharedSecret: credentials.sharedSecret,
      minDestinationAmount: '0'
    });

    const reply = streamServer.createReply({
      ...toPrepare(credentials.ilpAddress, encoded, '100'),
      data: Buffer.from('not-stream-ciphertext')
    });

    assert.equal(isIncomingMoney(reply), false);
    assert.equal((reply as { code: string }).code, 'F06');
  });
});
