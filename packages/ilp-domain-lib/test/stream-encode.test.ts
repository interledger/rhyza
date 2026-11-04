'use strict';

import assert from 'node:assert';
import { randomBytes } from 'node:crypto';
import { describe, test } from 'node:test';
import { StreamServer, type IncomingMoney } from '@interledger/stream-receiver';
import {
  ConnectionAssetDetailsFrame,
  ConnectionNewAddressFrame,
  IlpPacketType,
  Packet,
  StreamMoneyFrame,
  StreamReceiptFrame
} from 'ilp-protocol-stream/dist/src/packet.js';
import {
  decodeStreamPrepareAmount,
  decodeStreamReply,
  decryptStreamData,
  ENCRYPTION_KEY_STRING,
  hmacSha256
} from '../src/stream/decode.js';
import {
  encodeOutgoingStreamPrepare,
  encodeStreamFulfillReply,
  encodeStreamQuoteReply,
  rewriteStreamReplyAmount
} from '../src/stream/encode.js';

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

function decryptPrepare(sharedSecret: Buffer, data: Buffer): Packet {
  return Packet._deserializeUnencrypted(
    decryptStreamData(hmacSha256(sharedSecret, ENCRYPTION_KEY_STRING), data)
  );
}

function isIncomingMoney(reply: { accept?: unknown }): reply is IncomingMoney {
  return typeof reply.accept === 'function';
}

describe('STREAM outgoing encode', () => {
  test('produces a fulfillable condition that StreamServer.createReply accepts', () => {
    const { streamServer, credentials } = remoteReceiver();
    const encoded = encodeOutgoingStreamPrepare({
      sharedSecret: credentials.sharedSecret,
      minDestinationAmount: '100'
    });

    assert.equal(encoded.executionCondition.length, 32);
    assert.equal(encoded.fulfillment.length, 32);
    assert.ok(encoded.data.length > 0);

    const reply = streamServer.createReply({
      destination: credentials.ilpAddress,
      amount: '100',
      expiresAt: new Date(Date.now() + 30_000),
      executionCondition: encoded.executionCondition,
      data: encoded.data
    });
    assert.ok(isIncomingMoney(reply));
    assert.ok(reply.accept().fulfillment.equals(encoded.fulfillment));
  });

  test('encrypt/decrypt yields a STREAM packet with StreamMoney for the amount', () => {
    const sharedSecret = randomBytes(32);
    const encoded = encodeOutgoingStreamPrepare({
      sharedSecret,
      minDestinationAmount: '250',
      sequence: 7
    });

    const streamPacket = decryptPrepare(sharedSecret, encoded.data);
    assert.equal(streamPacket.sequence.toString(), '7');
    assert.equal(streamPacket.prepareAmount.toString(), '250');

    const money = streamPacket.frames.find(
      (frame): frame is StreamMoneyFrame => frame instanceof StreamMoneyFrame
    );
    assert.ok(money);
    assert.equal(money!.streamId.toString(), '1');
  });

  test('the prepare asks for asset details so the reply amount has a unit', () => {
    const sharedSecret = randomBytes(32);
    const encoded = encodeOutgoingStreamPrepare({
      sharedSecret,
      minDestinationAmount: '0'
    });

    const streamPacket = decryptPrepare(sharedSecret, encoded.data);
    assert.ok(
      streamPacket.frames.some(
        (frame) => frame instanceof ConnectionNewAddressFrame
      ),
      'expected ConnectionNewAddress to trigger the receiver asset reply'
    );
  });

  test('each encode uses fresh ciphertext so conditions differ', () => {
    const { streamServer, credentials } = remoteReceiver();
    const a = encodeOutgoingStreamPrepare({
      sharedSecret: credentials.sharedSecret,
      minDestinationAmount: '42'
    });
    const b = encodeOutgoingStreamPrepare({
      sharedSecret: credentials.sharedSecret,
      minDestinationAmount: '42'
    });

    // Nonce in encrypt makes ciphertext (and thus condition) differ.
    assert.notEqual(a.data.toString('base64'), b.data.toString('base64'));
    assert.notEqual(
      a.executionCondition.toString('base64'),
      b.executionCondition.toString('base64')
    );

    for (const encoded of [a, b]) {
      const reply = streamServer.createReply({
        destination: credentials.ilpAddress,
        amount: '42',
        expiresAt: new Date(Date.now() + 30_000),
        executionCondition: encoded.executionCondition,
        data: encoded.data
      });
      assert.ok(isIncomingMoney(reply));
    }
  });

  test('quote reply carries destination amount in STREAM prepareAmount', () => {
    const sharedSecret = randomBytes(32);
    const prepare = encodeOutgoingStreamPrepare({
      sharedSecret,
      minDestinationAmount: '0'
    });

    const replyData = encodeStreamQuoteReply({
      sharedSecret,
      prepareData: prepare.data,
      prepareAmount: '95'
    });
    assert.ok(replyData);

    assert.equal(decodeStreamPrepareAmount(sharedSecret, replyData!), '95');
    assert.equal(
      decodeStreamPrepareAmount(sharedSecret, Buffer.from('not-stream')),
      undefined
    );
  });

  test('quote reply names the asset the amount is denominated in', () => {
    const sharedSecret = randomBytes(32);
    const prepare = encodeOutgoingStreamPrepare({
      sharedSecret,
      minDestinationAmount: '0'
    });

    const replyData = encodeStreamQuoteReply({
      sharedSecret,
      prepareData: prepare.data,
      prepareAmount: '95',
      assetCode: 'EUR',
      assetScale: 2
    });
    assert.ok(replyData);

    const decoded = decodeStreamReply(sharedSecret, replyData!);
    assert.equal(decoded?.prepareAmount, '95');
    assert.equal(decoded?.assetCode, 'EUR');
    assert.equal(decoded?.assetScale, 2);
    assert.equal(decoded?.connectionClosed, false);

    const reply = decryptPrepare(sharedSecret, replyData!);
    assert.ok(
      reply.frames.some((frame) => frame instanceof ConnectionAssetDetailsFrame)
    );
  });

  test('undecryptable probe data yields no reply instead of throwing', () => {
    assert.equal(
      encodeStreamQuoteReply({
        sharedSecret: randomBytes(32),
        prepareData: Buffer.alloc(0),
        prepareAmount: '95'
      }),
      undefined
    );
  });

  test('fulfill reply carries the wallet amount in STREAM prepareAmount', () => {
    const sharedSecret = randomBytes(32);
    const prepare = encodeOutgoingStreamPrepare({
      sharedSecret,
      minDestinationAmount: '100'
    });

    const replyData = encodeStreamFulfillReply({
      sharedSecret,
      prepareData: prepare.data,
      prepareAmount: '95',
      assetCode: 'EUR',
      assetScale: 2
    });
    assert.ok(replyData);

    const decoded = decodeStreamReply(sharedSecret, replyData!);
    assert.equal(decoded?.prepareAmount, '95');
    assert.equal(decoded?.assetCode, 'EUR');
    assert.equal(decoded?.assetScale, 2);
    assert.equal(decoded?.connectionClosed, false);

    const reply = decryptPrepare(sharedSecret, replyData!);
    assert.equal(reply.ilpPacketType, IlpPacketType.Fulfill);
    assert.ok(
      reply.frames.some((frame) => frame instanceof ConnectionAssetDetailsFrame)
    );
  });

  test('rewriting a fulfill keeps the library frames and replaces the hop amount', () => {
    const streamServer = new StreamServer({
      serverSecret: randomBytes(32),
      serverAddress: 'test.receiver'
    });
    const credentials = streamServer.generateCredentials({
      paymentTag: 'intent-1',
      asset: { code: 'USD', scale: 2 },
      receiptSetup: {
        nonce: randomBytes(16),
        secret: randomBytes(32)
      }
    });
    const encoded = encodeOutgoingStreamPrepare({
      sharedSecret: credentials.sharedSecret,
      minDestinationAmount: '100'
    });
    const incoming = streamServer.createReply({
      destination: credentials.ilpAddress,
      amount: '100',
      expiresAt: new Date(Date.now() + 30_000),
      executionCondition: encoded.executionCondition,
      data: encoded.data
    });
    assert.ok(isIncomingMoney(incoming));
    incoming.setTotalReceived('95');
    const fulfill = incoming.accept();

    const rewritten = rewriteStreamReplyAmount({
      sharedSecret: credentials.sharedSecret,
      replyData: fulfill.data,
      prepareAmount: '95',
      assetCode: 'EUR',
      assetScale: 2
    });
    assert.ok(rewritten);

    const reply = decryptPrepare(credentials.sharedSecret, rewritten!);
    assert.equal(reply.ilpPacketType, IlpPacketType.Fulfill);
    assert.equal(reply.prepareAmount.toString(), '95');
    assert.equal(
      reply.frames.filter((frame) => frame instanceof StreamReceiptFrame)
        .length,
      1
    );
    const assets = reply.frames.filter(
      (frame): frame is ConnectionAssetDetailsFrame =>
        frame instanceof ConnectionAssetDetailsFrame
    );
    assert.equal(assets.length, 1);
    assert.equal(assets[0].sourceAssetCode, 'USD');
    assert.equal(assets[0].sourceAssetScale, 2);
  });

  test('rewriting a fulfill adds asset details when the library reply has none', () => {
    const streamServer = new StreamServer({
      serverSecret: randomBytes(32),
      serverAddress: 'test.receiver'
    });
    const credentials = streamServer.generateCredentials({
      paymentTag: 'intent-1'
    });
    const encoded = encodeOutgoingStreamPrepare({
      sharedSecret: credentials.sharedSecret,
      minDestinationAmount: '100'
    });
    const incoming = streamServer.createReply({
      destination: credentials.ilpAddress,
      amount: '100',
      expiresAt: new Date(Date.now() + 30_000),
      executionCondition: encoded.executionCondition,
      data: encoded.data
    });
    assert.ok(isIncomingMoney(incoming));
    const fulfill = incoming.accept();

    const rewritten = rewriteStreamReplyAmount({
      sharedSecret: credentials.sharedSecret,
      replyData: fulfill.data,
      prepareAmount: '95',
      assetCode: 'EUR',
      assetScale: 2
    });
    assert.ok(rewritten);

    const decoded = decodeStreamReply(credentials.sharedSecret, rewritten!);
    assert.equal(decoded?.prepareAmount, '95');
    assert.equal(decoded?.assetCode, 'EUR');
    assert.equal(decoded?.assetScale, 2);
  });

  test('undecryptable fulfill data yields no rewrite instead of throwing', () => {
    assert.equal(
      rewriteStreamReplyAmount({
        sharedSecret: randomBytes(32),
        replyData: Buffer.alloc(0),
        prepareAmount: '95'
      }),
      undefined
    );
  });
});
