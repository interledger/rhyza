import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMessage,
  IMessageConsumer,
  IMessageProducer,
  IMessageProducerAcks,
  NullLogger,
  TimerEventTopics
} from 'common-types-lib';
import {
  ExpirePaymentCmd,
  ExpirePaymentIntentCmd,
  PAYMENT_EXPIRY_CHECK_KEY,
  PaymentExpiryCheckTimerEvent
} from 'payments-domain-lib';
import { ExpiryCheckHandler } from '../src/expiry-check-handler';

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
  topics: string[] = [];
  setCallbackFn(): void {}
  setBatchCallbackFn(): void {}
  setFilteringFn(): void {}
  setOnRebalanceFn(): void {}
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
}

class FakeRepo {
  expiredIntentIds: string[] = [];
  expiredPayments: { paymentIntentId: string; paymentId: string }[] = [];
  intentQueryError?: Error;
  queries: { now: Date; limit: number }[] = [];

  async fetchExpiredPaymentIntentIds(
    now: Date,
    limit: number
  ): Promise<string[]> {
    this.queries.push({ now, limit });
    if (this.intentQueryError) throw this.intentQueryError;
    return this.expiredIntentIds;
  }

  async fetchExpiredRemotePayments(
    now: Date,
    limit: number
  ): Promise<{ paymentIntentId: string; paymentId: string }[]> {
    this.queries.push({ now, limit });
    return this.expiredPayments;
  }
}

const CONFIG = { tickIntervalMs: 1000, minCheckIntervalMs: 1000, limit: 50 };
const tick = () => new PaymentExpiryCheckTimerEvent();

describe('ExpiryCheckHandler', () => {
  let consumer: MockConsumer;
  let producer: MockProducer;
  let repo: FakeRepo;
  let handler: ExpiryCheckHandler;

  beforeEach(() => {
    consumer = new MockConsumer();
    producer = new MockProducer();
    repo = new FakeRepo();
    handler = new ExpiryCheckHandler(
      consumer,
      producer,
      repo,
      new NullLogger(),
      CONFIG
    );
  });

  it('subscribes to the payment timer topic and publishes a tick with the fixed key on each interval', async (context) => {
    context.mock.timers.enable({ apis: ['setInterval'] });

    await handler.start();
    context.mock.timers.tick(CONFIG.tickIntervalMs * 2);
    await handler.stop();

    assert.deepEqual(consumer.topics, [TimerEventTopics.PaymentTimerEvents]);
    assert.equal(producer.sent.length, 2);
    for (const message of producer.sent) {
      assert.equal(message.msgName, PaymentExpiryCheckTimerEvent.name);
      assert.equal(message.msgKey, PAYMENT_EXPIRY_CHECK_KEY);
      assert.equal(message.msgTopic, TimerEventTopics.PaymentTimerEvents);
    }
  });

  it('sends expire commands for what is due, keyed by payment intent', async () => {
    const intentId = crypto.randomUUID();
    const payment = {
      paymentIntentId: crypto.randomUUID(),
      paymentId: crypto.randomUUID()
    };
    repo.expiredIntentIds = [intentId];
    repo.expiredPayments = [payment];

    await handler.handleMessages([tick()]);

    assert.equal(producer.sent.length, 2);
    const [expireIntent, expirePayment] = producer.sent;
    assert.equal(expireIntent.msgName, ExpirePaymentIntentCmd.name);
    assert.deepEqual((expireIntent as ExpirePaymentIntentCmd).payload, {
      paymentIntentId: intentId
    });
    assert.equal(expireIntent.msgKey, intentId);
    assert.equal(expirePayment.msgName, ExpirePaymentCmd.name);
    assert.deepEqual((expirePayment as ExpirePaymentCmd).payload, payment);
    assert.equal(expirePayment.msgKey, payment.paymentIntentId);
    assert.equal(expireIntent.requestId, expirePayment.requestId);
  });

  it('passes the limit to each query', async () => {
    await handler.handleMessages([tick()]);

    assert.deepEqual(
      repo.queries.map((q) => q.limit),
      [CONFIG.limit, CONFIG.limit]
    );
  });

  it('runs one check for a batch of ticks', async () => {
    await handler.handleMessages([tick(), tick(), tick()]);

    assert.equal(repo.queries.length, 2);
  });

  it('skips a tick within the minimum check interval, then checks again after it', async (context) => {
    context.mock.timers.enable({ apis: ['Date'], now: 10_000 });

    await handler.handleMessages([tick()]);
    context.mock.timers.tick(CONFIG.minCheckIntervalMs - 1);
    await handler.handleMessages([tick()]);
    assert.equal(repo.queries.length, 2);

    context.mock.timers.tick(1);
    await handler.handleMessages([tick()]);
    assert.equal(repo.queries.length, 4);
  });

  it('ignores a batch without a tick', async () => {
    await handler.handleMessages([]);

    assert.equal(repo.queries.length, 0);
  });

  it('sends nothing when nothing is due', async () => {
    await handler.handleMessages([tick()]);

    assert.equal(producer.sent.length, 0);
  });

  it('still runs the other checks when one query fails', async () => {
    const payment = {
      paymentIntentId: crypto.randomUUID(),
      paymentId: crypto.randomUUID()
    };
    repo.intentQueryError = new Error('mongo down');
    repo.expiredPayments = [payment];

    await handler.handleMessages([tick()]);

    assert.deepEqual(
      producer.sent.map((m) => m.msgName),
      [ExpirePaymentCmd.name]
    );
  });
});
