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
  AcceptInboundPaymentCmd,
  FailInboundPaymentCmd,
  FinalizeInboundPaymentCmd,
  MarkInboundPaymentFulfilledCmd,
  ValidateInboundPaymentCmd
} from 'payments-domain-lib';
import {
  ILPPaymentFulfillmentFailedEvent,
  ILPPaymentFulfillmentSentEvent,
  ILPPaymentReceivedEvent
} from 'ilp-domain-lib';
import {
  LedgerIncomingTransferCommitFailedEvent,
  LedgerIncomingTransferCommittedEvent,
  LedgerIncomingTransferInsufficientFundsErrorEvent,
  LedgerIncomingTransferRejectedEvent,
  LedgerIncomingTransferRejectFailedEvent,
  LedgerIncomingTransferReserveFailedEvent,
  LedgerIncomingTransferReservedEvent
} from 'pal-public-types-lib';
import { PaymentsEventHandler } from '../src/event-handler';

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

const ledgerSuccess = {
  requestId: 'req-1',
  transferId: 'xfer-1',
  paymentIntentId: 'intent-1',
  paymentId: 'rp-1'
};
const ledgerFailure = { ...ledgerSuccess, errorMessage: 'Insufficient' };

const ilpInbound = {
  peerId: 'peer-1',
  packetId: 'packet-1',
  paymentIntentId: 'intent-1',
  paymentId: 'ilp-payment-1',
  inboundPaymentId: 'rp-1',
  requestId: 'req-1'
};

describe('PaymentsEventHandler inbound payments', () => {
  let consumer: MockConsumer;
  let producer: MockProducer;

  beforeEach(async () => {
    consumer = new MockConsumer();
    producer = new MockProducer();
    await new PaymentsEventHandler(
      consumer,
      producer,
      new NullLogger()
    ).start();
  });

  it('validates a received payment with a new ledger transfer id', async () => {
    await consumer.deliver([
      new ILPPaymentReceivedEvent({
        ...ilpInbound,
        sourceAmount: '100',
        expiresAt: new Date().toISOString()
      })
    ]);

    assert.equal(producer.sent.length, 1);
    const cmd = producer.sent[0] as ValidateInboundPaymentCmd;
    assert.equal(cmd.msgName, ValidateInboundPaymentCmd.name);
    assert.ok(cmd.payload.ledgerTransferId);
    assert.notEqual(cmd.payload.ledgerTransferId, cmd.payload.id);
  });

  it('accepts on reserved', async () => {
    await consumer.deliver([
      new LedgerIncomingTransferReservedEvent('USD', ledgerSuccess)
    ]);

    const cmd = producer.sent[0] as AcceptInboundPaymentCmd;
    assert.equal(cmd.msgName, AcceptInboundPaymentCmd.name);
    assert.deepEqual(cmd.payload, {
      inboundPaymentId: 'rp-1',
      paymentIntentId: 'intent-1'
    });
  });

  it('marks fulfilled when ILP sent the fulfill', async () => {
    await consumer.deliver([
      new ILPPaymentFulfillmentSentEvent({
        ...ilpInbound,
        fulfilledAt: new Date().toISOString()
      })
    ]);

    const cmd = producer.sent[0] as MarkInboundPaymentFulfilledCmd;
    assert.equal(cmd.msgName, MarkInboundPaymentFulfilledCmd.name);
    assert.equal(cmd.payload.inboundPaymentId, 'rp-1');
  });

  it('finalizes on committed', async () => {
    await consumer.deliver([
      new LedgerIncomingTransferCommittedEvent('USD', ledgerSuccess)
    ]);

    const cmd = producer.sent[0] as FinalizeInboundPaymentCmd;
    assert.equal(cmd.msgName, FinalizeInboundPaymentCmd.name);
    assert.equal(cmd.payload.inboundPaymentId, 'rp-1');
  });

  it('fails on FULFILL when ILP could not send the fulfill', async () => {
    await consumer.deliver([
      new ILPPaymentFulfillmentFailedEvent({
        ...ilpInbound,
        failedAt: new Date().toISOString(),
        reason: 'expired'
      })
    ]);

    const cmd = producer.sent[0] as FailInboundPaymentCmd;
    assert.equal(cmd.msgName, FailInboundPaymentCmd.name);
    assert.equal(cmd.payload.failedStep, 'FULFILL');
    assert.equal(cmd.payload.reason, 'expired');
  });

  for (const Event of [
    LedgerIncomingTransferInsufficientFundsErrorEvent,
    LedgerIncomingTransferReserveFailedEvent
  ]) {
    it(`fails on RESERVE for ${Event.name}`, async () => {
      await consumer.deliver([new Event('USD', ledgerFailure)]);

      const cmd = producer.sent[0] as FailInboundPaymentCmd;
      assert.equal(cmd.msgName, FailInboundPaymentCmd.name);
      assert.equal(cmd.payload.failedStep, 'RESERVE');
      assert.equal(cmd.payload.reason, 'Insufficient');
    });
  }

  it('only logs the reply to a void', async () => {
    await consumer.deliver([
      new LedgerIncomingTransferRejectedEvent('USD', ledgerSuccess)
    ]);

    assert.equal(producer.sent.length, 0);
  });

  for (const Event of [
    LedgerIncomingTransferCommitFailedEvent,
    LedgerIncomingTransferRejectFailedEvent
  ]) {
    it(`only logs ${Event.name}`, async () => {
      await consumer.deliver([new Event('USD', ledgerFailure)]);

      assert.equal(producer.sent.length, 0);
    });
  }
});
