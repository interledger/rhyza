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
import { IlpConnector } from '../src/connector';
import { LoopbackConnectorTransport } from './loopback-transport';
import {
  IConnectorTransport,
  WireFulfillOutbound,
  WireInboundPrepareHandler,
  WirePrepare,
  WireRejectOutbound,
  WireResponse,
  WireResponseHandler
} from '../src/transport';

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

// A transport that records what it was asked to send and only delivers
// responses / inbound prepares when the test explicitly triggers them.
class ManualTransport implements IConnectorTransport {
  readonly prepares: WirePrepare[] = [];
  readonly sentResponses: Array<WireFulfillOutbound | WireRejectOutbound> = [];
  private _onResponse?: WireResponseHandler;
  private _onInboundPrepare?: WireInboundPrepareHandler;

  async sendPrepare(prepare: WirePrepare): Promise<void> {
    this.prepares.push(prepare);
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
  async triggerResponse(response: WireResponse): Promise<void> {
    await this._onResponse?.(response);
  }
  async triggerInboundPrepare(prepare: WirePrepare): Promise<void> {
    await this._onInboundPrepare?.(prepare);
  }
}

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
  let connector: IlpConnector;

  beforeEach(() => {
    producer = new MockProducer();
    transport = new ManualTransport();
    connector = new IlpConnector(producer, transport);
    connector.init();
  });

  test('dispatching a prepare sends it on the wire and retains the correlation in-flight', async () => {
    await connector.handleConnectorCommands([dispatchPrepare()]);

    assert.equal(transport.prepares.length, 1);
    assert.equal(transport.prepares[0].packetId, 'packet-1');
    assert.equal(transport.prepares[0].destinationIlpAddress, 'g.peer.bob');
    // Held in-flight until a terminal response arrives; nothing produced yet.
    assert.equal(connector.inFlightCount, 1);
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
    // Partitioned by paymentIntentId per the connector contract.
    assert.equal(cmd.msgKey, 'intent-1');
    // Correlation consumed exactly once.
    assert.equal(connector.inFlightCount, 0);
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
    assert.equal(cmd.payload.packetId, 'packet-1');
    assert.equal(cmd.msgKey, 'intent-1');
    assert.equal(connector.inFlightCount, 0);
  });

  test('paymentIntentId is recovered from the in-flight map, never from the response packet', async () => {
    // The wire response intentionally carries no paymentIntentId - only packetId.
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

  test('an inbound prepare is published as a ProcessPreparePacketCmd keyed by packetId', async () => {
    await transport.triggerInboundPrepare({
      peerId: 'peer-9',
      packetId: 'inbound-1',
      destinationIlpAddress: 'g.us.alice',
      amount: '250',
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
      executionCondition: Buffer.alloc(32).toString('base64')
    });

    assert.equal(producer.sent.length, 1);
    const cmd = producer.sent[0] as ProcessPreparePacketCmd;
    assert.equal(cmd.msgName, ProcessPreparePacketCmd.name);
    assert.equal(cmd.payload.packetId, 'inbound-1');
    // Inbound is partitioned by packetId (no paymentIntentId is known yet).
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

  test('dispatch fulfill/reject commands are forwarded to the transport (inbound response path)', async () => {
    await connector.handleConnectorCommands([
      new DispatchFulfillPacketCmd({
        peerId: 'peer-1',
        packetId: 'inbound-1',
        fulfillment: Buffer.alloc(32).toString('base64')
      }),
      new DispatchRejectPacketCmd({
        peerId: 'peer-1',
        packetId: 'inbound-2',
        rejectCode: 'F06'
      })
    ]);

    assert.equal(transport.sentResponses.length, 2);
    assert.equal(transport.sentResponses[0].packetId, 'inbound-1');
    assert.equal(transport.sentResponses[1].packetId, 'inbound-2');
    // Neither is an outbound prepare, so nothing is held in-flight.
    assert.equal(connector.inFlightCount, 0);
  });
});

describe('IlpConnector over the loopback transport (full round trip)', () => {
  test('Dispatch prepare -> loopback wire -> Process reject, end to end', async () => {
    const producer = new MockProducer();
    const transport = new LoopbackConnectorTransport();
    const connector = new IlpConnector(producer, transport);
    connector.init();

    await connector.handleConnectorCommands([dispatchPrepare()]);

    // The loopback answers the probe with a reject (the expected quote outcome).
    assert.equal(producer.sent.length, 1);
    const cmd = producer.sent[0] as ProcessRejectPacketCmd;
    assert.equal(cmd.msgName, ProcessRejectPacketCmd.name);
    assert.equal(cmd.payload.paymentIntentId, 'intent-1');
    assert.equal(cmd.msgKey, 'intent-1');
    assert.equal(connector.inFlightCount, 0);
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
    const connector = new IlpConnector(producer, transport);
    connector.init();

    await connector.handleConnectorCommands([dispatchPrepare()]);

    assert.equal(producer.sent.length, 1);
    assert.equal(producer.sent[0].msgName, ProcessFulfillPacketCmd.name);
  });
});
