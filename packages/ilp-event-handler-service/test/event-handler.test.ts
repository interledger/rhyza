'use strict';

import assert from 'node:assert';
import { describe, test } from 'node:test';
import {
  ConsoleLogger,
  IMessage,
  IMessageConsumer,
  IMessageProducer,
  IMessageProducerAcks
} from 'common-types-lib';
import {
  ActivatePeerCmd,
  DeactivatePeerCmd,
  FulfillInboundPaymentCmd,
  RejectInboundPaymentCmd,
  ILPQuoteRequestReceivedEvent,
  RespondToRemoteQuoteCmd,
  StartRemotePaymentCmd,
  StartRemoteQuoteCmd
} from 'ilp-domain-lib';
import {
  RemoteQuoteCalculatedEvent,
  RemoteQuoteCalculationFailedEvent,
  RemoteQuoteRequestedEvent,
  InboundPaymentFulfillableEvent,
  InboundPaymentFailedEvent,
  RemotePaymentPreparedEvent
} from 'payments-public-types-lib';
import { PeerActivatedEvent, PeerDeactivatedEvent } from 'pal-public-types-lib';
import { IlpEventHandler } from '../src/event-handler';
import { FixedRateQuoteCalculator, PaymentsBcQuoteFixture } from './helpers';

class MockProducer implements IMessageProducer {
  readonly sent: IMessage[] = [];
  async send(message: IMessage | IMessage[]): Promise<IMessageProducerAcks[]> {
    this.sent.push(...(Array.isArray(message) ? message : [message]));
    return [];
  }
  async sendWithoutAcks(message: IMessage | IMessage[]): Promise<void> {
    await this.send(message);
  }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async destroy(): Promise<void> {}
}

class MockConsumer implements IMessageConsumer {
  private _batchCb?: (messages: IMessage[]) => Promise<void>;
  setCallbackFn(): void {}
  setBatchCallbackFn(cb: (messages: IMessage[]) => Promise<void>): void {
    this._batchCb = cb;
  }
  setFilteringFn(): void {}
  setTopics(): void {}
  setBatchSize(): void {}
  async destroy(): Promise<void> {}
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async start(): Promise<void> {}
  async startAndWaitForRebalance(): Promise<void> {}
  async stop(): Promise<void> {}
  async deliver(messages: IMessage[]): Promise<void> {
    await this._batchCb?.(messages);
  }
}

const request = () =>
  new ILPQuoteRequestReceivedEvent({
    peerId: 'peer-1',
    packetId: 'packet-in-1',
    paymentIntentId: 'intent-1',
    incomingAmount: '100',
    expiresAt: new Date().toISOString()
  });

describe('IlpEventHandler', () => {
  test('maps a RemoteQuoteRequestedEvent to a StartRemoteQuoteCmd with sharedSecret', async () => {
    const producer = new MockProducer();
    const consumer = new MockConsumer();
    const handler = new IlpEventHandler(
      consumer,
      producer,
      new ConsoleLogger()
    );
    await handler.start();

    await consumer.deliver([
      new RemoteQuoteRequestedEvent(
        {
          paymentIntentId: 'intent-1',
          quoteId: 'quote-1',
          requestId: 'req-1',
          senderWalletAddress: 'https://sender.example/alice',
          receiverWalletAddress: 'https://recv.example/bob',
          senderAssetCode: 'USD',
          senderAssetScale: 2,
          receiverAssetCode: 'EUR',
          receiverAssetScale: 2,
          peerId: 'peer-1',
          peerAssetCode: 'USD',
          peerAssetScale: 2,
          sourceAmount: '100',
          destinationIlpAddress: 'g.peer.bob',
          sharedSecret: 'c2VjcmV0'
        },
        'req-1'
      )
    ]);

    assert.equal(producer.sent.length, 1);
    const cmd = producer.sent[0] as StartRemoteQuoteCmd;
    assert.equal(cmd.msgName, StartRemoteQuoteCmd.name);
    assert.equal(cmd.payload.sharedSecret, 'c2VjcmV0');
    assert.equal(cmd.payload.destinationIlpAddress, 'g.peer.bob');
    assert.equal(cmd.payload.sourceAmount, '100');
    assert.equal(cmd.requestId, 'req-1');
  });

  test('maps a RemoteQuoteCalculatedEvent to a RespondToRemoteQuoteCmd', async () => {
    const producer = new MockProducer();
    const consumer = new MockConsumer();
    const handler = new IlpEventHandler(
      consumer,
      producer,
      new ConsoleLogger()
    );
    await handler.start();

    await consumer.deliver([
      new RemoteQuoteCalculatedEvent({
        peerId: 'peer-1',
        packetId: 'packet-in-1',
        paymentIntentId: 'intent-1',
        receiveAmount: '95',
        receiveAssetCode: 'USD',
        receiveAssetScale: 2
      })
    ]);

    assert.equal(producer.sent.length, 1);
    const cmd = producer.sent[0] as RespondToRemoteQuoteCmd;
    assert.equal(cmd.msgName, RespondToRemoteQuoteCmd.name);
    assert.equal(cmd.msgTopic, 'ilp-commands');
    assert.equal(cmd.msgKey, 'packet-in-1');
    assert.equal(cmd.payload.destinationAmount, '95');
  });

  test('maps a calculation-failed event to a command with no amount', async () => {
    const producer = new MockProducer();
    const consumer = new MockConsumer();
    const handler = new IlpEventHandler(
      consumer,
      producer,
      new ConsoleLogger()
    );
    await handler.start();

    await consumer.deliver([
      new RemoteQuoteCalculationFailedEvent({
        peerId: 'peer-1',
        packetId: 'packet-in-1',
        paymentIntentId: 'intent-1',
        errorName: 'QuoteCalculationFailed',
        message: 'no rate'
      })
    ]);

    assert.equal(producer.sent.length, 1);
    const cmd = producer.sent[0] as RespondToRemoteQuoteCmd;
    assert.equal(cmd.payload.destinationAmount, undefined);
  });

  test('maps a RemotePaymentPreparedEvent to a StartRemotePaymentCmd with sharedSecret', async () => {
    const producer = new MockProducer();
    const consumer = new MockConsumer();
    const handler = new IlpEventHandler(
      consumer,
      producer,
      new ConsoleLogger()
    );
    await handler.start();

    const sharedSecret = Buffer.alloc(32, 7).toString('base64url');
    await consumer.deliver([
      new RemotePaymentPreparedEvent({
        paymentIntentId: 'intent-1',
        paymentId: 'pay-1',
        ledgerTransferId: 'xfer-1',
        destinationIlpAddress: 'test.rhyza.token',
        peerId: 'peer-1',
        requestId: 'req-1',
        debitAmount: '100',
        receiveAmount: '100',
        assetCode: 'USD',
        assetScale: 2,
        sharedSecret,
        expiresAt: new Date(Date.now() + 30_000).toISOString()
      })
    ]);

    assert.equal(producer.sent.length, 1);
    const cmd = producer.sent[0] as StartRemotePaymentCmd;
    assert.equal(cmd.msgName, StartRemotePaymentCmd.name);
    assert.equal(cmd.msgTopic, 'ilp-commands');
    assert.equal(cmd.payload.peerId, 'peer-1');
    assert.equal(cmd.payload.paymentIntentId, 'intent-1');
    assert.equal(cmd.payload.paymentId, 'pay-1');
    assert.equal(cmd.payload.amount, '100');
    assert.equal(cmd.payload.sharedSecret, sharedSecret);
    assert.equal(cmd.requestId, 'req-1');
  });

  test('maps an InboundPaymentFulfillableEvent to a FulfillInboundPaymentCmd', async () => {
    const producer = new MockProducer();
    const consumer = new MockConsumer();
    const handler = new IlpEventHandler(
      consumer,
      producer,
      new ConsoleLogger()
    );
    await handler.start();

    await consumer.deliver([
      new InboundPaymentFulfillableEvent({
        paymentIntentId: 'intent-1',
        inboundPaymentId: 'rp-1',
        packetId: 'packet-in-1',
        peerId: 'peer-1',
        requestId: 'req-1',
        receiveAmount: '100',
        receiveAssetCode: 'USD',
        receiveAssetScale: 2,
        state: 'FULFILLABLE'
      })
    ]);

    assert.equal(producer.sent.length, 1);
    const cmd = producer.sent[0] as FulfillInboundPaymentCmd;
    assert.equal(cmd.msgName, FulfillInboundPaymentCmd.name);
    assert.equal(cmd.msgTopic, 'ilp-commands');
    assert.equal(cmd.msgKey, 'packet-in-1');
    assert.equal(cmd.payload.inboundPaymentId, 'rp-1');
    assert.equal(cmd.payload.paymentIntentId, 'intent-1');
    assert.equal(cmd.payload.receiveAmount, '100');
    assert.equal(cmd.payload.receiveAssetCode, 'USD');
    assert.equal(cmd.payload.receiveAssetScale, 2);
    assert.equal(cmd.requestId, 'req-1');
  });

  test('maps an InboundPaymentFailedEvent to a RejectInboundPaymentCmd without a reject code', async () => {
    const producer = new MockProducer();
    const consumer = new MockConsumer();
    const handler = new IlpEventHandler(
      consumer,
      producer,
      new ConsoleLogger()
    );
    await handler.start();

    await consumer.deliver([
      new InboundPaymentFailedEvent(
        {
          paymentIntentId: 'intent-1',
          inboundPaymentId: 'rp-1',
          packetId: 'packet-in-1',
          peerId: 'peer-1',
          errorName: 'InboundPaymentFailed',
          message: 'Ledger transfer failed'
        },
        'req-fail-1'
      )
    ]);

    assert.equal(producer.sent.length, 1);
    const cmd = producer.sent[0] as RejectInboundPaymentCmd;
    assert.equal(cmd.msgName, RejectInboundPaymentCmd.name);
    assert.equal(cmd.msgTopic, 'ilp-commands');
    assert.equal(cmd.msgKey, 'packet-in-1');
    assert.equal(cmd.payload.rejectCode, undefined);
    assert.equal(cmd.payload.rejectMessage, 'Ledger transfer failed');
    assert.equal(cmd.requestId, 'req-fail-1');
  });

  test('skips InboundPaymentFailedEvent without packet/peer correlation', async () => {
    const producer = new MockProducer();
    const consumer = new MockConsumer();
    const handler = new IlpEventHandler(
      consumer,
      producer,
      new ConsoleLogger()
    );
    await handler.start();

    await consumer.deliver([
      new InboundPaymentFailedEvent({
        paymentIntentId: 'intent-1',
        inboundPaymentId: 'rp-1',
        errorName: 'PaymentIntentNotFoundError',
        message: 'not found'
      })
    ]);

    assert.equal(producer.sent.length, 0);
  });

  test('maps a PAL PeerActivatedEvent to an ActivatePeerCmd', async () => {
    const producer = new MockProducer();
    const consumer = new MockConsumer();
    const handler = new IlpEventHandler(
      consumer,
      producer,
      new ConsoleLogger()
    );
    await handler.start();

    await consumer.deliver([new PeerActivatedEvent({ peerId: 'peer-1' })]);

    assert.equal(producer.sent.length, 1);
    const cmd = producer.sent[0] as ActivatePeerCmd;
    assert.equal(cmd.msgName, ActivatePeerCmd.name);
    assert.equal(cmd.msgTopic, 'ilp-commands');
    assert.equal(cmd.msgKey, 'peer-1');
    assert.equal(cmd.payload.peerId, 'peer-1');
    assert.ok(cmd.requestId, 'expected a requestId to be propagated');
  });

  test('maps a PAL PeerDeactivatedEvent to a DeactivatePeerCmd', async () => {
    const producer = new MockProducer();
    const consumer = new MockConsumer();
    const handler = new IlpEventHandler(
      consumer,
      producer,
      new ConsoleLogger()
    );
    await handler.start();

    await consumer.deliver([new PeerDeactivatedEvent({ peerId: 'peer-1' })]);

    assert.equal(producer.sent.length, 1);
    const cmd = producer.sent[0] as DeactivatePeerCmd;
    assert.equal(cmd.msgName, DeactivatePeerCmd.name);
    assert.equal(cmd.msgTopic, 'ilp-commands');
    assert.equal(cmd.msgKey, 'peer-1');
    assert.equal(cmd.payload.peerId, 'peer-1');
  });

  test('ignores unrelated Payments BC events', async () => {
    const producer = new MockProducer();
    const consumer = new MockConsumer();
    const handler = new IlpEventHandler(
      consumer,
      producer,
      new ConsoleLogger()
    );
    await handler.start();

    await consumer.deliver([
      { msgName: 'SomeOtherPaymentEvent', payload: {} } as unknown as IMessage
    ]);

    assert.equal(producer.sent.length, 0);
  });
});

describe('PaymentsBcQuoteFixture', () => {
  test('answers a request with a calculated event (1:1 default rate)', async () => {
    const producer = new MockProducer();
    const consumer = new MockConsumer();
    const fixture = new PaymentsBcQuoteFixture(
      consumer,
      producer,
      new ConsoleLogger()
    );
    await fixture.start();

    await consumer.deliver([request()]);

    assert.equal(producer.sent.length, 1);
    const event = producer.sent[0] as RemoteQuoteCalculatedEvent;
    assert.equal(event.msgName, RemoteQuoteCalculatedEvent.name);
    assert.equal(event.msgTopic, 'payment-domain-events');
    assert.equal(event.payload.packetId, 'packet-in-1');
    assert.equal(event.payload.receiveAmount, '100');
  });

  test('applies the configured FX rate', async () => {
    const producer = new MockProducer();
    const consumer = new MockConsumer();
    const fixture = new PaymentsBcQuoteFixture(
      consumer,
      producer,
      new ConsoleLogger(),
      new FixedRateQuoteCalculator(95n, 100n)
    );
    await fixture.start();

    await consumer.deliver([request()]);

    const event = producer.sent[0] as RemoteQuoteCalculatedEvent;
    assert.equal(event.payload.receiveAmount, '95');
  });

  test('emits a calculation-failed event for an invalid amount', async () => {
    const producer = new MockProducer();
    const consumer = new MockConsumer();
    const fixture = new PaymentsBcQuoteFixture(
      consumer,
      producer,
      new ConsoleLogger()
    );
    await fixture.start();

    await consumer.deliver([
      new ILPQuoteRequestReceivedEvent({
        peerId: 'peer-1',
        packetId: 'packet-in-1',
        paymentIntentId: 'intent-1',
        incomingAmount: 'not-a-number',
        expiresAt: new Date().toISOString()
      })
    ]);

    assert.equal(producer.sent.length, 1);
    assert.equal(
      producer.sent[0].msgName,
      RemoteQuoteCalculationFailedEvent.name
    );
  });
});
