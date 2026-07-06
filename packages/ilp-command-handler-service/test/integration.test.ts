'use strict';

import assert from 'node:assert';
import { describe, test } from 'node:test';
import {
  CommandTopics,
  ConsoleLogger,
  DomainEventTopics,
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
  RemotePaymentFailedEvent,
  StartRemoteQuoteCmd
} from 'ilp-domain-lib';
import {
  InMemoryPeerRepository,
  KafkaPeeringClient
} from 'ilp-implementations-lib';

import { IlpConnector } from 'ilp-connector-service/dist/src/connector.js';
import type {
  IConnectorTransport,
  WirePrepare,
  WireResponse,
  WireResponseHandler,
  WireInboundPrepareHandler,
  WireFulfillOutbound,
  WireRejectOutbound
} from 'ilp-connector-service/dist/src/transport.js';
import { IlpCommandHandler } from '../src/cmd-handler';

type BatchCb = (messages: IMessage[]) => Promise<void>;

class InMemoryBus {
  private readonly _subscriptions: { topics: Set<string>; cb?: BatchCb }[] = [];
  readonly published: IMessage[] = [];

  producer(): IMessageProducer {
    const route = (message: IMessage | IMessage[]) =>
      this._route(Array.isArray(message) ? message : [message]);
    return {
      async send(message): Promise<IMessageProducerAcks[]> {
        await route(message);
        return [];
      },
      async sendWithoutAcks(message): Promise<void> {
        await route(message);
      },
      async connect(): Promise<void> {},
      async disconnect(): Promise<void> {},
      async destroy(): Promise<void> {}
    };
  }

  consumer(): IMessageConsumer {
    const subscription: { topics: Set<string>; cb?: BatchCb } = {
      topics: new Set()
    };
    this._subscriptions.push(subscription);
    return {
      setTopics: (topics: string[]) => {
        subscription.topics = new Set(topics);
      },
      setBatchCallbackFn: (cb: BatchCb) => {
        subscription.cb = cb;
      },
      setCallbackFn: () => {},
      setFilteringFn: () => {},
      setBatchSize: () => {},
      connect: async () => {},
      disconnect: async () => {},
      start: async () => {},
      startAndWaitForRebalance: async () => {},
      stop: async () => {},
      destroy: async () => {}
    };
  }

  private async _route(messages: IMessage[]): Promise<void> {
    this.published.push(...messages);
    for (const subscription of this._subscriptions) {
      const forSubscription = messages.filter((m) =>
        subscription.topics.has(m.msgTopic)
      );
      if (forSubscription.length > 0 && subscription.cb) {
        await subscription.cb(forSubscription);
      }
    }
  }
}

// Transport double for the connector's wire port. When `autoReject` is set it
// answers every outbound prepare with a reject (the expected quote outcome);
// otherwise it stays silent so the packet remains in-flight and the expiry
// path can be exercised.
class TestTransport implements IConnectorTransport {
  private _onResponse?: WireResponseHandler;
  private _onInboundPrepare?: WireInboundPrepareHandler;
  readonly sentResponses: Array<WireFulfillOutbound | WireRejectOutbound> = [];

  constructor(private readonly _autoReject = false) {}

  async sendPrepare(prepare: WirePrepare): Promise<void> {
    if (this._autoReject && this._onResponse) {
      const response: WireResponse = {
        kind: 'REJECT',
        packetId: prepare.packetId,
        rejectCode: 'F99',
        rejectMessage: 'loopback: probe rejected'
      };
      await this._onResponse(response);
    }
  }
  async sendFulfill(fulfill: WireFulfillOutbound): Promise<void> {
    this.sentResponses.push(fulfill);
  }
  async sendReject(reject: WireRejectOutbound): Promise<void> {
    this.sentResponses.push(reject);
  }
  onResponse(handler: WireResponseHandler): void {
    this._onResponse = handler;
  }
  onInboundPrepare(handler: WireInboundPrepareHandler): void {
    this._onInboundPrepare = handler;
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

// Wires the real command handler and the real connector together over the bus,
// exactly as the two deployed services are wired over Kafka.
async function wireSystem(autoReject: boolean) {
  const bus = new InMemoryBus();
  const logger = new ConsoleLogger();
  const producer = bus.producer();

  const transport = new TestTransport(autoReject);
  const connector = new IlpConnector(producer, transport, logger);
  connector.init();
  const connectorConsumer = bus.consumer();
  connectorConsumer.setTopics([CommandTopics.IlpConnectorCommands]);
  connectorConsumer.setBatchCallbackFn((messages) =>
    connector.handleConnectorCommands(messages)
  );
  await connectorConsumer.connect();
  await connectorConsumer.startAndWaitForRebalance();

  const repo = new InMemoryPeerRepository([PEER]);
  const aggregate = new IlpPeerAggregate(
    repo,
    new KafkaPeeringClient(producer, logger)
  );
  const handler = new IlpCommandHandler(
    bus.consumer(),
    producer,
    aggregate,
    logger
  );
  await handler.start();

  return { bus, producer };
}

const dispatchedPacketId = (bus: InMemoryBus): string => {
  const dispatch = bus.published.find(
    (m) => m.msgName === DispatchPreparePacketCmd.name
  ) as DispatchPreparePacketCmd | undefined;
  assert.ok(dispatch, 'expected the connector to receive a probe dispatch');
  return dispatch.payload.packetId;
};

const eventsOnTopic = (bus: InMemoryBus, name: string) =>
  bus.published.filter(
    (m) => m.msgTopic === DomainEventTopics.IlpEvents && m.msgName === name
  );

describe('ILP command handler <-> connector over Kafka topics', () => {
  test('start quote -> connector probe -> peer reject -> QuoteFailedEvent', async () => {
    const { bus, producer } = await wireSystem(true);

    // A StartRemoteQuoteCmd lands on ilp-commands (from Payments BC).
    await producer.send(startQuote());

    // The aggregate dispatched a probe that the connector put on the wire.
    const dispatch = bus.published.find(
      (m) => m.msgName === DispatchPreparePacketCmd.name
    ) as DispatchPreparePacketCmd;
    assert.ok(dispatch, 'expected a DispatchPreparePacketCmd to the connector');
    assert.equal(dispatch.msgTopic, CommandTopics.IlpConnectorCommands);
    assert.equal(dispatch.payload.amount, '100');

    // The connector turned the peer's reject into a ProcessRejectPacketCmd on
    // ilp-commands, which the aggregate consumed.
    const reject = bus.published.find(
      (m) => m.msgName === ProcessRejectPacketCmd.name
    ) as ProcessRejectPacketCmd;
    assert.ok(
      reject,
      'expected the connector to emit a ProcessRejectPacketCmd'
    );
    assert.equal(reject.payload.paymentIntentId, 'intent-1');

    // The scaffolded connector does not yet decode STREAM amounts, so a reject
    // resolves to a QuoteFailedEvent. Either way the reject travelled the full
    // path and was never surfaced as an ILP transport error.
    const failed = eventsOnTopic(bus, QuoteFailedEvent.name);
    assert.equal(failed.length, 1);
    assert.equal((failed[0] as QuoteFailedEvent).payload.quoteId, 'quote-1');

    // A quote reject must never trigger the payment failure/liquidity path.
    assert.equal(eventsOnTopic(bus, RemotePaymentFailedEvent.name).length, 0);
  });

  test('a quote with no response before expiry -> QuoteFailedEvent (timeout)', async () => {
    const { bus, producer } = await wireSystem(false);

    await producer.send(startQuote());
    const packetId = dispatchedPacketId(bus);
    // No wire response arrived; the expiry worker publishes ExpirePacketCmd.
    await producer.send(
      new ExpirePacketCmd({
        peerId: 'peer-1',
        packetId,
        expiredAt: new Date().toISOString()
      })
    );

    const failed = eventsOnTopic(bus, QuoteFailedEvent.name);
    assert.equal(failed.length, 1);
    assert.equal((failed[0] as QuoteFailedEvent).payload.expired, true);
    assert.equal(eventsOnTopic(bus, RemotePaymentFailedEvent.name).length, 0);
  });

  test('a reject carrying decoded amounts -> RemoteQuoteReceivedEvent', async () => {
    // The connector cannot decode STREAM amounts yet, so we inject the reject a
    // future connector would emit (amounts present) onto ilp-commands to prove
    // the determined path flows through the same seam end to end.
    const { bus, producer } = await wireSystem(false);

    await producer.send(startQuote());
    const packetId = dispatchedPacketId(bus);

    await producer.send(
      new ProcessRejectPacketCmd({
        peerId: 'peer-1',
        paymentIntentId: 'intent-1',
        packetId,
        rejectCode: 'F99',
        rejectMessage: 'quote response',
        rejectedAt: new Date().toISOString(),
        destinationAmount: '95'
      })
    );

    const determined = eventsOnTopic(bus, RemoteQuoteReceivedEvent.name);
    assert.equal(determined.length, 1);
    assert.equal(
      (determined[0] as RemoteQuoteReceivedEvent).payload.destinationAmount,
      '95'
    );
    assert.equal(eventsOnTopic(bus, QuoteFailedEvent.name).length, 0);
  });
});
