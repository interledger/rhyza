import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMessage,
  IMessageConsumer,
  IMessageProducer,
  IMessageProducerAcks,
  NullLogger
} from 'common-types-lib';
import {
  InboundPaymentAcceptedEvent,
  InboundPaymentAcceptFailedEvent,
  InboundPaymentExpiredEvent,
  InboundPaymentFailedEvent,
  InboundPaymentFulfilledEvent,
  InboundPaymentFulfillFailedEvent,
  InboundPaymentReserveFailedEvent,
  InboundPaymentStepFailedPayload,
  InboundPaymentValidatedEvent,
  PaymentExpiredEvent
} from 'payments-public-types-lib';
import {
  CommitTransferCmd,
  RejectTransferCmd,
  ReserveTransferCmd
} from 'pal-domain-lib';
import { IntegrationEventHandler } from '../src/handlers/integration-event-handler';

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
  setOnRebalanceFn(): void {}
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

const stepFailedPayload = (): InboundPaymentStepFailedPayload => ({
  paymentIntentId: 'intent-1',
  inboundPaymentId: 'rp-1',
  packetId: 'packet-1',
  peerId: 'peer-1',
  requestId: 'req-1',
  ledgerTransferId: 'xfer-1',
  receiveAssetCode: 'USD',
  reason: 'failed',
  state: 'FAILED'
});

describe('IntegrationEventHandler', () => {
  let consumer: MockConsumer;
  let producer: MockProducer;

  beforeEach(async () => {
    consumer = new MockConsumer();
    producer = new MockProducer();
    await new IntegrationEventHandler(
      consumer,
      producer,
      new NullLogger()
    ).init();
  });

  it('reserves an incoming transfer with the validated ledger transfer id', async () => {
    await consumer.deliver([
      new InboundPaymentValidatedEvent({
        paymentIntentId: 'intent-1',
        inboundPaymentId: 'rp-1',
        packetId: 'packet-1',
        peerId: 'peer-1',
        requestId: 'req-1',
        ledgerTransferId: 'xfer-1',
        sourceAmount: '100',
        peerAssetCode: 'USD',
        peerAssetScale: 2,
        receiveAmount: '100',
        receiveAssetCode: 'USD',
        receiveAssetScale: 2,
        state: 'VALIDATED',
        createdAt: new Date()
      })
    ]);

    assert.equal(producer.sent.length, 1);
    const cmd = producer.sent[0] as ReserveTransferCmd;
    assert.equal(cmd.msgName, ReserveTransferCmd.name);
    assert.equal(cmd.payload.transferId, 'xfer-1');
    assert.equal(cmd.payload.transferDirection, 'INCOMING');
    assert.equal(cmd.payload.paymentId, 'rp-1');
  });

  it('commits an incoming transfer once fulfilled', async () => {
    await consumer.deliver([
      new InboundPaymentFulfilledEvent({
        paymentIntentId: 'intent-1',
        inboundPaymentId: 'rp-1',
        packetId: 'packet-1',
        peerId: 'peer-1',
        requestId: 'req-1',
        ledgerTransferId: 'xfer-1',
        receiveAmount: '100',
        receiveAssetCode: 'USD',
        receiveAssetScale: 2,
        state: 'FULFILLED'
      })
    ]);

    assert.equal(producer.sent.length, 1);
    const cmd = producer.sent[0] as CommitTransferCmd;
    assert.equal(cmd.msgName, CommitTransferCmd.name);
    assert.equal(cmd.payload.transferId, 'xfer-1');
    assert.equal(cmd.payload.transferDirection, 'INCOMING');
  });

  for (const Event of [
    InboundPaymentAcceptFailedEvent,
    InboundPaymentFulfillFailedEvent,
    InboundPaymentExpiredEvent
  ]) {
    it(`voids the incoming reservation on ${Event.name}`, async () => {
      await consumer.deliver([new Event(stepFailedPayload())]);

      assert.equal(producer.sent.length, 1);
      const cmd = producer.sent[0] as RejectTransferCmd;
      assert.equal(cmd.msgName, RejectTransferCmd.name);
      assert.equal(cmd.msgKey, 'USD');
      assert.equal(cmd.payload.transferId, 'xfer-1');
      assert.equal(cmd.payload.transferDirection, 'INCOMING');
      assert.equal(cmd.payload.paymentId, 'rp-1');
    });
  }

  it('does nothing for accepted, reserve failed and unexpected failures', async () => {
    await consumer.deliver([
      new InboundPaymentAcceptedEvent({
        paymentIntentId: 'intent-1',
        inboundPaymentId: 'rp-1',
        packetId: 'packet-1',
        peerId: 'peer-1',
        requestId: 'req-1',
        ledgerTransferId: 'xfer-1',
        receiveAmount: '100',
        receiveAssetCode: 'USD',
        receiveAssetScale: 2,
        state: 'ACCEPTED'
      }),
      new InboundPaymentReserveFailedEvent(stepFailedPayload()),
      new InboundPaymentFailedEvent({
        paymentIntentId: 'intent-1',
        inboundPaymentId: 'rp-1',
        errorName: 'PaymentInvalidStateError',
        errorType: 'FailedPrecondition',
        message: 'unexpected'
      })
    ]);

    assert.equal(producer.sent.length, 0);
  });

  it('voids the outgoing reservation of an expired payment', async () => {
    await consumer.deliver([
      new PaymentExpiredEvent({
        paymentIntentId: 'intent-1',
        paymentId: 'pay-1',
        ledgerTransferId: 'xfer-out-1',
        peerId: 'peer-1',
        requestId: 'req-1',
        debitAmount: '100',
        assetCode: 'EUR',
        assetScale: 2,
        expiresAt: new Date()
      })
    ]);

    assert.equal(producer.sent.length, 1);
    const cmd = producer.sent[0] as RejectTransferCmd;
    assert.equal(cmd.msgName, RejectTransferCmd.name);
    assert.equal(cmd.msgKey, 'EUR');
    assert.equal(cmd.payload.transferId, 'xfer-out-1');
    assert.equal(cmd.payload.transferDirection, 'OUTGOING');
    assert.equal(cmd.payload.paymentId, 'pay-1');
  });
});
