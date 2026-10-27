'use strict';

import assert from 'node:assert';
import { afterEach, describe, test } from 'node:test';
import {
  ConsoleLogger,
  IMessage,
  IMessageConsumer,
  IMessageProducer,
  IMessageProducerAcks
} from 'common-types-lib';
import { DispatchPreparePacketCmd, ILPPeerCreatedEvent } from 'ilp-domain-lib';
import { IlpConnectorService } from '../src/service';
import { OutboundExpiryWorker } from '../src/outbound-expiry-worker';
import { PeerDirectory } from '../src/peer-directory';
import { IConnectorTransport, WirePrepare } from '../src/transport';

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

// Same double pattern used elsewhere in this package's tests, but each
// instance tracks its own topics/callback so a test can tell the two
// consumers built by the service apart.
class MockConsumer implements IMessageConsumer {
  topics: string[] = [];
  private _batchCb?: (messages: IMessage[]) => Promise<void>;
  setCallbackFn(): void {}
  setBatchCallbackFn(cb: (messages: IMessage[]) => Promise<void>): void {
    this._batchCb = cb;
  }
  setFilteringFn(): void {}
  setTopics(topics: string[]): void {
    this.topics = topics;
  }
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

class NoopTransport implements IConnectorTransport {
  readonly prepares: WirePrepare[] = [];
  async sendPrepare(prepare: WirePrepare): Promise<void> {
    this.prepares.push(prepare);
  }
  async sendFulfill(): Promise<void> {}
  async sendReject(): Promise<void> {}
  onResponse(): void {}
  onInboundPrepare(): void {}
  onOutboundPrepareAccepted(): void {}
}

const noopExpiryWorker = () =>
  new OutboundExpiryWorker(
    { processExpiredOutboundPackets: async () => {} } as never,
    10_000
  );

describe('IlpConnectorService — split consumers', () => {
  afterEach(async () => {
    await IlpConnectorService.stop();
  });

  test('the commands consumer and the directory consumer subscribe to different topics', async () => {
    const commandsConsumer = new MockConsumer();
    const directoryConsumer = new MockConsumer();
    const directory = new PeerDirectory();

    await IlpConnectorService.start({
      logger: new ConsoleLogger(),
      producer: new MockProducer(),
      consumer: commandsConsumer,
      directoryConsumer,
      transport: new NoopTransport(),
      directory,
      outboundExpiryWorker: noopExpiryWorker()
    });

    assert.deepEqual(commandsConsumer.topics, ['ilp-connector-commands']);
    assert.deepEqual(directoryConsumer.topics, ['ilp-domain-events']);
  });

  test('a peer event on the directory consumer updates the directory, not the connector', async () => {
    const commandsConsumer = new MockConsumer();
    const directoryConsumer = new MockConsumer();
    const directory = new PeerDirectory();
    const transport = new NoopTransport();

    await IlpConnectorService.start({
      logger: new ConsoleLogger(),
      producer: new MockProducer(),
      consumer: commandsConsumer,
      directoryConsumer,
      transport,
      directory,
      outboundExpiryWorker: noopExpiryWorker()
    });

    await directoryConsumer.deliver([
      new ILPPeerCreatedEvent({
        peerId: 'peer-1',
        http: {
          outgoing: {
            endpoint: 'http://peer.example/ilp',
            callbackEndpoint: 'http://peer.example/ilp/callback',
            authToken: 't'
          }
        },
        isActive: true
      })
    ]);

    assert.equal(
      directory.getOutgoing('peer-1')?.endpoint,
      'http://peer.example/ilp'
    );
    // The connector command consumer never saw this message.
    assert.equal(transport.prepares.length, 0);
  });

  test('a dispatch command on the commands consumer reaches the connector/transport', async () => {
    const commandsConsumer = new MockConsumer();
    const directoryConsumer = new MockConsumer();
    const transport = new NoopTransport();

    await IlpConnectorService.start({
      logger: new ConsoleLogger(),
      producer: new MockProducer(),
      consumer: commandsConsumer,
      directoryConsumer,
      transport,
      directory: new PeerDirectory(),
      outboundExpiryWorker: noopExpiryWorker()
    });

    await commandsConsumer.deliver([
      new DispatchPreparePacketCmd({
        peerId: 'peer-1',
        packetId: 'packet-1',
        paymentIntentId: 'intent-1',
        destinationIlpAddress: 'g.us.alice',
        amount: '100',
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        executionCondition: Buffer.alloc(32).toString('base64')
      })
    ]);

    assert.equal(transport.prepares.length, 1);
    assert.equal(transport.prepares[0].packetId, 'packet-1');
  });
});
