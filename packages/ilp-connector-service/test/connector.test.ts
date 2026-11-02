'use strict';

import assert from 'node:assert';
import { beforeEach, describe, test } from 'node:test';
import {
  IMessage,
  IMessageProducer,
  IMessageProducerAcks
} from 'common-types-lib';
import {
  DispatchFulfillPacketCmd,
  DispatchPreparePacketCmd,
  DispatchRejectPacketCmd,
  ProcessFulfillPacketCmd,
  ProcessPreparePacketCmd,
  ProcessRejectPacketCmd
} from 'ilp-domain-lib';
import { InMemoryTransportCorrelationStore } from '../src/correlation/in-memory-store';
import { IlpConnector } from '../src/connector';
import { LoopbackConnectorTransport } from './loopback-transport';
import {
  IConnectorTransport,
  WireFulfill,
  WireInboundPrepareHandler,
  WireOutboundPrepareAcceptedHandler,
  WirePrepare,
  WireReject,
  WireResponse,
  WireResponseHandler
} from '../src/transport';
import type { SentWireReply } from './loopback-transport';

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

class ManualTransport implements IConnectorTransport {
  readonly prepares: WirePrepare[] = [];
  readonly sentResponses: SentWireReply[] = [];
  private _onResponse?: WireResponseHandler;
  private _onInboundPrepare?: WireInboundPrepareHandler;
  private _onOutboundPrepareAccepted?: WireOutboundPrepareAcceptedHandler;

  async sendPrepare(prepare: WirePrepare): Promise<void> {
    this.prepares.push(prepare);
    await this._onOutboundPrepareAccepted?.(prepare);
  }
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
  onResponse(handler: WireResponseHandler): void {
    this._onResponse = handler;
  }
  onInboundPrepare(handler: WireInboundPrepareHandler): void {
    this._onInboundPrepare = handler;
  }
  onOutboundPrepareAccepted(handler: WireOutboundPrepareAcceptedHandler): void {
    this._onOutboundPrepareAccepted = handler;
  }
  async triggerResponse(response: WireResponse): Promise<void> {
    await this._onResponse?.(response);
  }
  async triggerInboundPrepare(prepare: WirePrepare): Promise<void> {
    await this._onInboundPrepare?.(prepare);
  }
}

const TEST_EXPIRES_AT = new Date(Date.now() + 30_000).toISOString();

const dispatchPrepare = (
  overrides: Partial<DispatchPreparePacketCmd['payload']> = {}
) =>
  new DispatchPreparePacketCmd({
    peerId: 'peer-1',
    packetId: 'packet-1',
    paymentIntentId: 'intent-1',
    destinationIlpAddress: 'g.peer.bob',
    amount: '100',
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    executionCondition: Buffer.alloc(32).toString('base64'),
    ...overrides
  });

describe('IlpConnector', () => {
  let producer: MockProducer;
  let transport: ManualTransport;
  let correlationStore: InMemoryTransportCorrelationStore;
  let connector: IlpConnector;

  beforeEach(() => {
    producer = new MockProducer();
    transport = new ManualTransport();
    correlationStore = new InMemoryTransportCorrelationStore();
    connector = new IlpConnector(producer, transport, correlationStore);
    connector.init();
  });

  test('dispatching a prepare stores outbound correlation and schedules expiry', async () => {
    await connector.handleConnectorCommands([dispatchPrepare()]);

    assert.equal(transport.prepares.length, 1);
    assert.equal(transport.prepares[0].packetId, 'packet-1');
    assert.equal(
      await correlationStore.hasOutboundCorrelation('packet-1'),
      true
    );
    assert.equal(producer.sent.length, 0);
  });

  test('a peer reject produces a ProcessRejectPacketCmd keyed by paymentIntentId', async () => {
    await connector.handleConnectorCommands([dispatchPrepare()]);
    await transport.triggerResponse({
      kind: 'REJECT',
      packetId: 'packet-1',
      rejectCode: 'F99',
      rejectMessage: 'probe'
    });

    assert.equal(producer.sent.length, 1);
    const cmd = producer.sent[0] as ProcessRejectPacketCmd;
    assert.equal(cmd.msgName, ProcessRejectPacketCmd.name);
    assert.equal(cmd.payload.paymentIntentId, 'intent-1');
    assert.equal(cmd.payload.packetId, 'packet-1');
    assert.equal(cmd.payload.rejectCode, 'F99');
    assert.equal(cmd.payload.data, undefined);
    assert.equal(cmd.msgKey, 'intent-1');
    assert.equal(
      await correlationStore.hasOutboundCorrelation('packet-1'),
      false
    );
  });

  test('a quote reject forwards opaque data without parsing destinationAmount', async () => {
    await connector.handleConnectorCommands([dispatchPrepare()]);
    const data = Buffer.from('opaque-stream-reject').toString('base64');
    await transport.triggerResponse({
      kind: 'REJECT',
      packetId: 'packet-1',
      rejectCode: 'F99',
      rejectMessage: 'quote response',
      data
    });

    const cmd = producer.sent[0] as ProcessRejectPacketCmd;
    assert.equal(cmd.payload.data, data);
    assert.equal(
      (cmd.payload as { destinationAmount?: string }).destinationAmount,
      undefined
    );
  });

  test('a peer fulfill produces a ProcessFulfillPacketCmd keyed by paymentIntentId', async () => {
    await connector.handleConnectorCommands([dispatchPrepare()]);
    await transport.triggerResponse({
      kind: 'FULFILL',
      packetId: 'packet-1',
      fulfillment: Buffer.alloc(32).toString('base64')
    });

    assert.equal(producer.sent.length, 1);
    const cmd = producer.sent[0] as ProcessFulfillPacketCmd;
    assert.equal(cmd.msgName, ProcessFulfillPacketCmd.name);
    assert.equal(cmd.payload.paymentIntentId, 'intent-1');
    assert.equal(cmd.msgKey, 'intent-1');
    assert.equal(cmd.payload.fulfillment, Buffer.alloc(32).toString('base64'));
    assert.equal(
      await correlationStore.hasOutboundCorrelation('packet-1'),
      false
    );
  });

  test('a peer fulfill forwards opaque data without parsing it', async () => {
    await connector.handleConnectorCommands([dispatchPrepare()]);
    const data = Buffer.from('opaque-stream-fulfill').toString('base64');
    await transport.triggerResponse({
      kind: 'FULFILL',
      packetId: 'packet-1',
      fulfillment: Buffer.alloc(32).toString('base64'),
      data
    });

    const cmd = producer.sent[0] as ProcessFulfillPacketCmd;
    assert.equal(cmd.payload.data, data);
    assert.equal(
      (cmd.payload as { destinationAmount?: string }).destinationAmount,
      undefined
    );
  });

  test('paymentIntentId is recovered from the correlation store, never from the response packet', async () => {
    await connector.handleConnectorCommands([
      dispatchPrepare({ packetId: 'p-xyz', paymentIntentId: 'intent-xyz' })
    ]);
    await transport.triggerResponse({
      kind: 'REJECT',
      packetId: 'p-xyz',
      rejectCode: 'F99'
    });

    const cmd = producer.sent[0] as ProcessRejectPacketCmd;
    assert.equal(cmd.payload.paymentIntentId, 'intent-xyz');
  });

  test('an inbound prepare is published as a ProcessPreparePacketCmd', async () => {
    await transport.triggerInboundPrepare({
      peerId: 'peer-9',
      packetId: 'inbound-1',
      destinationIlpAddress: 'g.us.alice',
      amount: '250',
      expiresAt: TEST_EXPIRES_AT,
      executionCondition: Buffer.alloc(32).toString('base64')
    });

    assert.equal(producer.sent.length, 1);
    const cmd = producer.sent[0] as ProcessPreparePacketCmd;
    assert.equal(cmd.msgName, ProcessPreparePacketCmd.name);
    assert.equal(cmd.payload.packetId, 'inbound-1');
    assert.equal(cmd.payload.peerId, 'peer-9');
    assert.equal(cmd.msgKey, 'inbound-1');
  });

  test('a response for an unknown packetId is dropped without producing a command', async () => {
    await transport.triggerResponse({
      kind: 'REJECT',
      packetId: 'never-dispatched',
      rejectCode: 'F99'
    });
    assert.equal(producer.sent.length, 0);
  });

  test('a batch of dispatches runs concurrently, not one at a time', async () => {
    const delays: Record<string, number> = {
      'packet-slow-1': 150,
      'packet-slow-2': 150
    };
    class SlowTransport extends ManualTransport {
      async sendPrepare(prepare: WirePrepare): Promise<void> {
        await new Promise((r) => setTimeout(r, delays[prepare.packetId] ?? 0));
        await super.sendPrepare(prepare);
      }
    }
    const slowTransport = new SlowTransport();
    const slowConnector = new IlpConnector(
      producer,
      slowTransport,
      correlationStore
    );
    slowConnector.init();

    const before = Date.now();
    await slowConnector.handleConnectorCommands([
      dispatchPrepare({ packetId: 'packet-slow-1' }),
      dispatchPrepare({ packetId: 'packet-slow-2' })
    ]);
    const elapsed = Date.now() - before;

    assert.equal(slowTransport.prepares.length, 2);
    assert.ok(
      elapsed < 250,
      `expected concurrent dispatch (~150ms), took ${elapsed}ms - looks sequential`
    );
  });

  test('one dispatch throwing does not stop the others in the same batch from running', async () => {
    class FlakyTransport extends ManualTransport {
      async sendPrepare(prepare: WirePrepare): Promise<void> {
        if (prepare.packetId === 'packet-throws') {
          throw new Error('simulated transport failure');
        }
        await super.sendPrepare(prepare);
      }
    }
    const flakyTransport = new FlakyTransport();
    const flakyConnector = new IlpConnector(
      producer,
      flakyTransport,
      correlationStore
    );
    flakyConnector.init();

    await flakyConnector.handleConnectorCommands([
      dispatchPrepare({ packetId: 'packet-throws' }),
      dispatchPrepare({ packetId: 'packet-fine' })
    ]);

    assert.ok(
      flakyTransport.prepares.some((p) => p.packetId === 'packet-fine'),
      'expected the non-throwing dispatch to still go out'
    );
  });

  test('dispatch fulfill/reject commands are forwarded to the transport', async () => {
    await connector.handleConnectorCommands([
      new DispatchFulfillPacketCmd({
        peerId: 'peer-1',
        packetId: 'inbound-1',
        callbackDeadline: TEST_EXPIRES_AT,
        fulfillment: Buffer.alloc(32).toString('base64')
      }),
      new DispatchRejectPacketCmd({
        peerId: 'peer-1',
        packetId: 'inbound-2',
        callbackDeadline: TEST_EXPIRES_AT,
        rejectCode: 'F06'
      })
    ]);

    assert.equal(transport.sentResponses.length, 2);
    assert.equal(transport.sentResponses[0].peerId, 'peer-1');
    assert.equal(transport.sentResponses[1].peerId, 'peer-1');
  });

  test('processExpiredOutboundPackets publishes R00 when no callback arrives', async () => {
    await connector.handleConnectorCommands([
      dispatchPrepare({
        packetId: 'packet-expired',
        expiresAt: new Date(Date.now() - 1).toISOString()
      })
    ]);

    await connector.processExpiredOutboundPackets();

    assert.equal(producer.sent.length, 1);
    const cmd = producer.sent[0] as ProcessRejectPacketCmd;
    assert.equal(cmd.payload.rejectCode, 'R00');
    assert.equal(cmd.payload.packetId, 'packet-expired');
  });
});

describe('IlpConnector over the loopback transport (full round trip)', () => {
  test('Dispatch prepare -> loopback wire -> Process reject, end to end', async () => {
    const producer = new MockProducer();
    const store = new InMemoryTransportCorrelationStore();
    const transport = new LoopbackConnectorTransport();
    const connector = new IlpConnector(producer, transport, store);
    connector.init();

    await connector.handleConnectorCommands([dispatchPrepare()]);

    assert.equal(producer.sent.length, 1);
    const cmd = producer.sent[0] as ProcessRejectPacketCmd;
    assert.equal(cmd.msgName, ProcessRejectPacketCmd.name);
    assert.equal(cmd.payload.paymentIntentId, 'intent-1');
    assert.equal(await store.hasOutboundCorrelation('packet-1'), false);
  });

  test('loopback can be configured to fulfill, exercising the payment path', async () => {
    const producer = new MockProducer();
    const transport = new LoopbackConnectorTransport({
      responder: (prepare): WireResponse => ({
        kind: 'FULFILL',
        packetId: prepare.packetId,
        fulfillment: Buffer.alloc(32).toString('base64')
      })
    });
    const connector = new IlpConnector(
      producer,
      transport,
      new InMemoryTransportCorrelationStore()
    );
    connector.init();

    await connector.handleConnectorCommands([dispatchPrepare()]);

    assert.equal(producer.sent.length, 1);
    assert.equal(producer.sent[0].msgName, ProcessFulfillPacketCmd.name);
  });
});
