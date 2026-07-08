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
  DispatchPreparePacketCmd,
  ExpirePacketCmd,
  IlpPeerAggregate,
  IPeer,
  ProcessRejectPacketCmd,
  RemoteQuoteReceivedEvent,
  QuoteFailedEvent,
  StartRemoteQuoteCmd
} from 'ilp-domain-lib';
import {
  InMemoryPeerRepository,
  KafkaPeeringClient
} from 'ilp-implementations-lib';
import { IlpCommandHandler } from '../src/cmd-handler';

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

// Captures the batch callback the handler registers and lets the test push
// batches through it, standing in for the Kafka consumer.
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

const PEER: IPeer = {
  peerId: 'peer-1',
  http: { outgoing: { endpoint: 'https://peer.example/ilp', authToken: 't' } },
  isActive: true
};

const startQuote = () =>
  new StartRemoteQuoteCmd({
    peerId: 'peer-1',
    paymentIntentId: 'intent-1',
    quoteId: 'quote-1',
    destinationIlpAddress: 'g.peer.bob',
    sourceAmount: '100',
    sourceAssetCode: 'USD',
    sourceAssetScale: 2
  });

async function startedHandler() {
  const producer = new MockProducer();
  const consumer = new MockConsumer();
  const repo = new InMemoryPeerRepository([PEER]);
  const peeringClient = new KafkaPeeringClient(producer, new ConsoleLogger());
  const aggregate = new IlpPeerAggregate(repo, peeringClient);
  const handler = new IlpCommandHandler(
    consumer,
    producer,
    aggregate,
    new ConsoleLogger()
  );
  await handler.start();
  return { producer, consumer };
}

const dispatchedPacketId = (producer: MockProducer): string => {
  const dispatch = producer.sent.find(
    (m) => m.msgName === DispatchPreparePacketCmd.name
  ) as DispatchPreparePacketCmd | undefined;
  assert.ok(dispatch, 'expected a DispatchPreparePacketCmd to be produced');
  return dispatch.payload.packetId;
};

describe('IlpCommandHandler — remote quote sending', () => {
  test('starting a remote quote dispatches a probe to the connector', async () => {
    const { producer, consumer } = await startedHandler();
    await consumer.deliver([startQuote()]);

    const dispatch = producer.sent.find(
      (m) => m.msgName === DispatchPreparePacketCmd.name
    ) as DispatchPreparePacketCmd;
    assert.ok(dispatch);
    assert.equal(dispatch.msgTopic, 'ilp-connector-commands');
    assert.equal(dispatch.msgKey, 'peer-1');
    assert.equal(dispatch.payload.paymentIntentId, 'intent-1');
    assert.equal(dispatch.payload.amount, '100');
    assert.ok(dispatch.payload.executionCondition.length > 0);
    assert.ok(dispatch.payload.expiresAt);
  });

  test('a peer reject carrying amounts yields a RemoteQuoteReceivedEvent', async () => {
    const { producer, consumer } = await startedHandler();
    await consumer.deliver([startQuote()]);
    const packetId = dispatchedPacketId(producer);

    await consumer.deliver([
      new ProcessRejectPacketCmd({
        peerId: 'peer-1',
        paymentIntentId: 'intent-1',
        packetId,
        rejectCode: 'F99',
        rejectMessage: 'quote response',
        rejectedAt: new Date().toISOString(),
        destinationAmount: '95'
      })
    ]);

    const event = producer.sent.find(
      (m) => m.msgName === RemoteQuoteReceivedEvent.name
    ) as RemoteQuoteReceivedEvent;
    assert.ok(event, 'expected a RemoteQuoteReceivedEvent');
    assert.equal(event.msgTopic, 'ilp-domain-events');
    assert.equal(event.payload.quoteId, 'quote-1');
    assert.equal(event.payload.destinationAmount, '95');
  });

  test('a peer reject without amounts yields a QuoteFailedEvent', async () => {
    const { producer, consumer } = await startedHandler();
    await consumer.deliver([startQuote()]);
    const packetId = dispatchedPacketId(producer);

    await consumer.deliver([
      new ProcessRejectPacketCmd({
        peerId: 'peer-1',
        paymentIntentId: 'intent-1',
        packetId,
        rejectCode: 'F02',
        rejectMessage: 'unreachable',
        rejectedAt: new Date().toISOString()
      })
    ]);

    const event = producer.sent.find(
      (m) => m.msgName === QuoteFailedEvent.name
    ) as QuoteFailedEvent;
    assert.ok(event, 'expected a QuoteFailedEvent');
    assert.equal(event.payload.rejectCode, 'F02');
    assert.equal(event.isErrorEvent, true);
  });

  test('an expiry with no response yields a QuoteFailedEvent (timeout)', async () => {
    const { producer, consumer } = await startedHandler();
    await consumer.deliver([startQuote()]);
    const packetId = dispatchedPacketId(producer);

    await consumer.deliver([
      new ExpirePacketCmd({
        peerId: 'peer-1',
        packetId,
        expiredAt: new Date().toISOString()
      })
    ]);

    const event = producer.sent.find(
      (m) => m.msgName === QuoteFailedEvent.name
    ) as QuoteFailedEvent;
    assert.ok(event, 'expected a QuoteFailedEvent');
    assert.equal(event.payload.expired, true);
  });
});

describe('KafkaPeeringClient', () => {
  test('maps a QUOTE dispatch to a DispatchPreparePacketCmd on the connector topic', async () => {
    const producer = new MockProducer();
    const client = new KafkaPeeringClient(producer, new ConsoleLogger());

    await client.dispatch({
      type: 'QUOTE',
      peerId: 'peer-9',
      packetId: 'pk-9',
      paymentIntentId: 'intent-9',
      quoteId: 'q-9',
      destinationIlpAddress: 'g.peer.bob',
      sourceAmount: '250',
      sourceAssetCode: 'USD',
      sourceAssetScale: 2,
      expiresAt: new Date().toISOString()
    });

    assert.equal(producer.sent.length, 1);
    const cmd = producer.sent[0] as DispatchPreparePacketCmd;
    assert.equal(cmd.msgName, DispatchPreparePacketCmd.name);
    assert.equal(cmd.msgTopic, 'ilp-connector-commands');
    assert.equal(cmd.msgKey, 'peer-9');
    assert.equal(cmd.payload.amount, '250');
    assert.equal(cmd.payload.packetId, 'pk-9');
    assert.equal(
      Buffer.from(cmd.payload.executionCondition, 'base64').length,
      32
    );
  });
});
