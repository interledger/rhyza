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
  createFakeResolveStreamCredentials,
  decodeStreamPrepareAmount,
  encodeOutgoingStreamPrepare,
  IlpPeerAggregate,
  IPeer,
  ILPQuoteRequestReceivedEvent
} from 'ilp-domain-lib';
import {
  InMemoryPeerRepository,
  KafkaPeeringClient
} from 'ilp-implementations-lib';
import { IlpConnector } from 'ilp-connector-service/dist/src/connector.js';
import { InMemoryTransportCorrelationStore } from 'ilp-connector-service/dist/src/correlation/in-memory-store.js';
import type {
  IConnectorTransport,
  WireFulfill,
  WireInboundPrepareHandler,
  WirePrepare,
  WireReject
} from 'ilp-connector-service/dist/src/transport.js';
import { IlpCommandHandler } from 'ilp-command-handler-service/dist/cmd-handler.js';
import { IlpEventHandler } from '../src/event-handler';
import { FixedRateQuoteCalculator, PaymentsBcQuoteFixture } from './helpers';
import { IQuoteCalculator } from './helpers/quote-calculator';

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

// Transport double that lets the test inject an inbound prepare (a peer
// initiating a quoting probe) and captures the reject the connector sends back.
type SentWireReply = {
  peerId: string;
  callbackDeadline: string;
  response: WireFulfill | WireReject;
};

class ReceivingTransport implements IConnectorTransport {
  private _onInboundPrepare?: WireInboundPrepareHandler;
  readonly sentResponses: SentWireReply[] = [];

  async sendPrepare(): Promise<void> {}
  async sendFulfill(
    fulfill: WireFulfill,
    peerId: string,
    callbackDeadline: string
  ): Promise<void> {
    this.sentResponses.push({ peerId, callbackDeadline, response: fulfill });
  }
  async sendReject(
    reject: WireReject,
    peerId: string,
    callbackDeadline: string
  ): Promise<void> {
    this.sentResponses.push({ peerId, callbackDeadline, response: reject });
  }
  onResponse(): void {}
  onInboundPrepare(handler: WireInboundPrepareHandler): void {
    this._onInboundPrepare = handler;
  }
  async simulateInboundPrepare(prepare: WirePrepare): Promise<void> {
    await this._onInboundPrepare?.(prepare);
  }
}

const PEER: IPeer = {
  peerId: 'peer-1',
  http: {
    outgoing: {
      endpoint: 'https://peer.example/ilp',
      callbackEndpoint: 'https://peer.example/ilp/callback',
      authToken: 't'
    }
  },
  isActive: true
};

const probe = (
  destinationIlpAddress: string,
  overrides: Partial<WirePrepare> = {}
): WirePrepare => ({
  peerId: 'peer-1',
  packetId: 'packet-in-1',
  destinationIlpAddress,
  amount: '100',
  expiresAt: new Date(Date.now() + 30_000).toISOString(),
  executionCondition: Buffer.alloc(32).toString('base64'),
  ...overrides
});

const streamQuoteProbe = (
  destinationIlpAddress: string,
  sharedSecret: Buffer,
  overrides: Partial<WirePrepare> = {}
): WirePrepare => {
  const encoded = encodeOutgoingStreamPrepare({
    sharedSecret,
    minDestinationAmount: '0'
  });
  return probe(destinationIlpAddress, {
    data: encoded.data.toString('base64'),
    executionCondition: Buffer.alloc(32).toString('base64'),
    ...overrides
  });
};

// Wires the connector, ILP command handler, ILP event handler and a test
// Payments BC fixture together over the bus, mirroring the deployed services.
async function wireSystem(calculator?: IQuoteCalculator) {
  const bus = new InMemoryBus();
  const logger = new ConsoleLogger();
  const producer = bus.producer();

  const transport = new ReceivingTransport();
  const correlationStore = new InMemoryTransportCorrelationStore();
  const connector = new IlpConnector(
    producer,
    transport,
    correlationStore,
    logger
  );
  connector.init();
  const connectorConsumer = bus.consumer();
  connectorConsumer.setTopics([CommandTopics.IlpConnectorCommands]);
  connectorConsumer.setBatchCallbackFn((messages) =>
    connector.handleConnectorCommands(messages)
  );
  await connectorConsumer.connect();
  await connectorConsumer.startAndWaitForRebalance();

  const fake = createFakeResolveStreamCredentials();
  const credentials = fake.issueCredentials('intent-1');

  const repo = new InMemoryPeerRepository([PEER]);
  const aggregate = new IlpPeerAggregate(
    repo,
    new KafkaPeeringClient(producer, logger),
    fake.resolveStreamCredentials,
    fake.streamServer
  );
  const cmdHandler = new IlpCommandHandler(
    bus.consumer(),
    producer,
    aggregate,
    logger
  );
  await cmdHandler.start();

  const eventHandler = new IlpEventHandler(bus.consumer(), producer, logger);
  await eventHandler.start();

  const paymentsBcFixture = new PaymentsBcQuoteFixture(
    bus.consumer(),
    producer,
    logger,
    calculator
  );
  await paymentsBcFixture.start();

  return {
    bus,
    transport,
    destinationIlpAddress: credentials.ilpAddress,
    sharedSecret: credentials.sharedSecret
  };
}

const lastReject = (
  transport: ReceivingTransport
): { peerId: string; response: WireReject } => {
  assert.equal(
    transport.sentResponses.length,
    1,
    'expected exactly one reject'
  );
  const sent = transport.sentResponses[0];
  assert.equal(sent.response.kind, 'REJECT');
  return {
    peerId: sent.peerId,
    response: sent.response as WireReject
  };
};

const requestReceivedEvents = (bus: InMemoryBus) =>
  bus.published.filter(
    (m) =>
      m.msgTopic === DomainEventTopics.IlpEvents &&
      m.msgName === ILPQuoteRequestReceivedEvent.name
  );

describe('ILP receiving quote flow over Kafka topics', () => {
  test('inbound probe -> request received -> Payments BC quote -> STREAM reject', async () => {
    const { bus, transport, destinationIlpAddress, sharedSecret } =
      await wireSystem(new FixedRateQuoteCalculator(95n, 100n));

    await transport.simulateInboundPrepare(
      streamQuoteProbe(destinationIlpAddress, sharedSecret)
    );

    // The aggregate decoded the probe and published the request received event.
    assert.equal(requestReceivedEvents(bus).length, 1);

    // The probe was answered on the wire with a reject carrying the calculated
    // destination amount in STREAM prepareAmount (F99 = quote response).
    const reject = lastReject(transport);
    assert.equal(reject.peerId, 'peer-1');
    assert.equal(reject.response.packetId, 'packet-in-1');
    assert.equal(reject.response.rejectCode, 'F99');
    assert.ok(
      reject.response.data,
      'expected STREAM quote reply data on the reject'
    );
    assert.equal(
      decodeStreamPrepareAmount(
        sharedSecret,
        Buffer.from(reject.response.data as string, 'base64')
      ),
      '95'
    );
  });

  test('an unresolved peer is answered with a generic reject and no event', async () => {
    const { bus, transport, destinationIlpAddress } = await wireSystem();

    await transport.simulateInboundPrepare(
      probe(destinationIlpAddress, { peerId: 'peer-unknown' })
    );

    assert.equal(requestReceivedEvents(bus).length, 0);
    const reject = lastReject(transport);
    assert.equal(reject.response.rejectCode, 'T00');
    assert.equal(reject.response.data, undefined);
  });

  test('an invalid amount is answered with F03', async () => {
    const { bus, transport, destinationIlpAddress } = await wireSystem();

    await transport.simulateInboundPrepare(
      probe(destinationIlpAddress, { amount: '' })
    );

    assert.equal(requestReceivedEvents(bus).length, 0);
    const reject = lastReject(transport);
    assert.equal(reject.response.rejectCode, 'F03');
  });
});
