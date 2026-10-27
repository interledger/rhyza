'use strict';

import assert from 'node:assert';
import { randomBytes } from 'node:crypto';
import { describe, test } from 'node:test';
import {
  ConsoleLogger,
  IMessage,
  IMessageConsumer,
  IMessageProducer,
  IMessageProducerAcks
} from 'common-types-lib';
import {
  ConnectionCloseFrame,
  ErrorCode,
  IlpPacketType,
  Packet
} from 'ilp-protocol-stream/dist/src/packet.js';
import {
  DispatchRejectPacketCmd,
  ExpirePacketCmd,
  encryptStreamData,
  encodeOutgoingStreamPrepare,
  createFakeResolveStreamCredentials,
  hmacSha256,
  IlpPeerAggregate,
  IPeer,
  ENCRYPTION_KEY_STRING,
  decodeStreamPrepareAmount,
  decodeStreamReply,
  ProcessPreparePacketCmd,
  ILPPaymentFailedEvent,
  ILPQuoteRequestReceivedEvent,
  ILPPaymentReceivedEvent,
  ILPPaymentFulfillmentSentEvent,
  ILPPaymentFulfillmentFailedEvent,
  FulfillInboundPaymentCmd,
  DispatchFulfillPacketCmd,
  RespondToRemoteQuoteCmd,
  RejectInboundPaymentCmd
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
  http: {
    outgoing: {
      endpoint: 'https://peer.example/ilp',
      callbackEndpoint: 'https://peer.example/ilp/callback',
      authToken: 't'
    }
  },
  isActive: true
};

const PAYMENT_INTENT_ID = 'intent-1';

function fulfillablePrepareData(sharedSecret: Buffer): {
  data: string;
  executionCondition: string;
  fulfillment: Buffer;
} {
  const encoded = encodeOutgoingStreamPrepare({
    sharedSecret,
    minDestinationAmount: '100'
  });
  return {
    data: encoded.data.toString('base64'),
    executionCondition: encoded.executionCondition.toString('base64'),
    fulfillment: encoded.fulfillment
  };
}

// A prepare whose STREAM packet carries ConnectionClose: a peer walking away
// mid-connection rather than probing for a rate.
function connectionClosePrepare(sharedSecret: Buffer): {
  data: string;
  executionCondition: string;
} {
  const packet = new Packet(1, IlpPacketType.Prepare, '0', [
    new ConnectionCloseFrame(ErrorCode.NoError, 'bye')
  ]);
  return {
    data: encryptStreamData(
      hmacSha256(sharedSecret, ENCRYPTION_KEY_STRING),
      packet._serialize()
    ).toString('base64'),
    executionCondition: randomBytes(32).toString('base64')
  };
}

function unfulfillableStreamPrepare(
  sharedSecret: Buffer,
  minDestinationAmount: string = '0'
): { data: string; executionCondition: string } {
  const encoded = encodeOutgoingStreamPrepare({
    sharedSecret,
    minDestinationAmount
  });
  return {
    data: encoded.data.toString('base64'),
    executionCondition: randomBytes(32).toString('base64')
  };
}

async function startedHandler(
  seedPeers: IPeer[] = [PEER],
  fake = createFakeResolveStreamCredentials(),
  paymentIntentId: string | null = PAYMENT_INTENT_ID
) {
  const credentials =
    paymentIntentId !== null
      ? fake.issueCredentials(paymentIntentId)
      : undefined;
  const producer = new MockProducer();
  const consumer = new MockConsumer();
  const repo = new InMemoryPeerRepository(seedPeers);
  const peeringClient = new KafkaPeeringClient(producer, new ConsoleLogger());
  const aggregate = new IlpPeerAggregate(
    repo,
    peeringClient,
    fake.resolveStreamCredentials,
    fake.streamServer,
    fake.serverAddress
  );
  const handler = new IlpCommandHandler(
    consumer,
    producer,
    aggregate,
    new ConsoleLogger()
  );
  await handler.start();
  return { producer, consumer, repo, credentials, fake };
}

const inboundProbe = (
  destinationIlpAddress: string,
  overrides: Record<string, unknown> = {}
) =>
  new ProcessPreparePacketCmd({
    peerId: 'peer-1',
    packetId: 'packet-in-1',
    destinationIlpAddress,
    amount: '100',
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    executionCondition: Buffer.alloc(32).toString('base64'),
    ...overrides
  });

const rejectFor = (producer: MockProducer): DispatchRejectPacketCmd =>
  producer.sent.find(
    (m) => m.msgName === DispatchRejectPacketCmd.name
  ) as DispatchRejectPacketCmd;

describe('IlpCommandHandler — remote quote receiving', () => {
  test('an inbound probe publishes a ILPQuoteRequestReceivedEvent with paymentIntentId', async () => {
    const { producer, consumer, repo, credentials, fake } =
      await startedHandler();
    assert.ok(credentials);
    const resolved = await fake.resolveStreamCredentials(
      credentials.ilpAddress
    );
    assert.ok(resolved);
    await consumer.deliver([
      inboundProbe(
        credentials.ilpAddress,
        unfulfillableStreamPrepare(resolved.sharedSecret)
      )
    ]);

    const event = producer.sent.find(
      (m) => m.msgName === ILPQuoteRequestReceivedEvent.name
    ) as ILPQuoteRequestReceivedEvent;
    assert.ok(event, 'expected a ILPQuoteRequestReceivedEvent');
    assert.equal(event.msgTopic, 'ilp-domain-events');
    assert.equal(event.payload.peerId, 'peer-1');
    assert.equal(event.payload.packetId, 'packet-in-1');
    assert.equal(event.payload.incomingAmount, '100');
    assert.equal(event.payload.paymentIntentId, PAYMENT_INTENT_ID);
    assert.equal(
      (event.payload as { destinationIlpAddress?: string })
        .destinationIlpAddress,
      undefined
    );

    const stored = await repo.fetchPacketById('packet-in-1');
    assert.ok(stored);
    assert.equal(stored!.kind, 'QUOTE');
    assert.ok(stored!.inboundPrepare);

    assert.equal(
      producer.sent.filter((m) => m.msgName === DispatchRejectPacketCmd.name)
        .length,
      0
    );
  });

  test('a calculated quote produces a reject carrying the amount', async () => {
    const { producer, consumer, credentials, fake } = await startedHandler();
    const resolved = await fake.resolveStreamCredentials(
      credentials.ilpAddress
    );
    assert.ok(resolved);
    await consumer.deliver([
      inboundProbe(
        credentials.ilpAddress,
        unfulfillableStreamPrepare(resolved.sharedSecret)
      )
    ]);
    await consumer.deliver([
      new RespondToRemoteQuoteCmd({
        peerId: 'peer-1',
        packetId: 'packet-in-1',
        destinationAmount: '95'
      })
    ]);

    const reject = rejectFor(producer);
    assert.ok(reject, 'expected a DispatchRejectPacketCmd');
    assert.equal(reject.msgTopic, 'ilp-connector-commands');
    assert.equal(reject.msgKey, 'peer-1');
    assert.equal(reject.payload.peerId, 'peer-1');
    assert.equal(reject.payload.packetId, 'packet-in-1');
    assert.equal(reject.payload.rejectCode, 'F99');
    assert.equal(reject.payload.triggeredBy, 'test.rhyza');
    assert.ok(reject.payload.data, 'expected STREAM quote reply data');
    assert.equal(
      decodeStreamPrepareAmount(
        resolved.sharedSecret,
        Buffer.from(reject.payload.data as string, 'base64')
      ),
      '95'
    );
  });

  test('an invalid amount yields F03 and no event', async () => {
    const { producer, consumer, credentials } = await startedHandler();
    await consumer.deliver([
      inboundProbe(credentials.ilpAddress, { amount: '' })
    ]);

    const reject = rejectFor(producer);
    assert.ok(reject, 'expected an F03 reject');
    assert.equal(reject.payload.rejectCode, 'F03');
    assert.equal(reject.payload.triggeredBy, 'test.rhyza');
    assert.equal(reject.payload.data, undefined, 'must not leak detail');
    assert.equal(
      producer.sent.filter(
        (m) => m.msgName === ILPQuoteRequestReceivedEvent.name
      ).length,
      0
    );
  });

  test('an already-expired inbound prepare is rejected with R00 and never stored', async () => {
    const { producer, consumer, repo, credentials } = await startedHandler();
    await consumer.deliver([
      inboundProbe(credentials.ilpAddress, {
        expiresAt: new Date(Date.now() - 1_000).toISOString()
      })
    ]);

    const reject = rejectFor(producer);
    assert.ok(reject, 'expected an R00 reject');
    assert.equal(reject.payload.rejectCode, 'R00');
    assert.equal(
      producer.sent.filter(
        (m) =>
          m.msgName === ILPQuoteRequestReceivedEvent.name ||
          m.msgName === ILPPaymentReceivedEvent.name
      ).length,
      0
    );
    assert.equal(await repo.fetchPacketById('packet-in-1'), undefined);
  });

  test('a quote response after the prepare clock has passed still carries the rate', async () => {
    const { producer, consumer, repo, credentials, fake } =
      await startedHandler();
    const resolved = await fake.resolveStreamCredentials(
      credentials.ilpAddress
    );
    assert.ok(resolved);
    await consumer.deliver([
      inboundProbe(
        credentials.ilpAddress,
        unfulfillableStreamPrepare(resolved.sharedSecret)
      )
    ]);
    const stored = await repo.fetchPacketById('packet-in-1');
    assert.ok(stored);
    await repo.updatePacket({
      ...stored,
      expiresAt: new Date(Date.now() - 1_000)
    });
    producer.sent.length = 0;

    await consumer.deliver([
      new RespondToRemoteQuoteCmd({
        peerId: 'peer-1',
        packetId: 'packet-in-1',
        destinationAmount: '95'
      })
    ]);

    const reject = rejectFor(producer);
    assert.ok(reject);
    assert.equal(reject.payload.rejectCode, 'F99');
    assert.equal(
      decodeStreamPrepareAmount(
        resolved.sharedSecret,
        Buffer.from((reject.payload.data as string) ?? '', 'base64')
      ),
      '95'
    );
    const after = await repo.fetchPacketById('packet-in-1');
    assert.equal(after?.state, 'REJECTED');
  });

  test('an unresolved destination yields F06', async () => {
    const { producer, consumer } = await startedHandler(
      [PEER],
      createFakeResolveStreamCredentials(),
      null
    );
    await consumer.deliver([inboundProbe('test.rhyza.unknown-token')]);

    const reject = rejectFor(producer);
    assert.ok(reject, 'expected an F06 reject');
    assert.equal(reject.payload.rejectCode, 'F06');
    assert.equal(reject.payload.data, undefined);
    assert.equal(
      producer.sent.filter(
        (m) => m.msgName === ILPQuoteRequestReceivedEvent.name
      ).length,
      0
    );
  });

  test('an unresolved peer yields a generic T00 reject', async () => {
    const { producer, consumer, credentials } = await startedHandler();
    await consumer.deliver([
      inboundProbe(credentials.ilpAddress, { peerId: 'peer-unknown' })
    ]);

    const reject = rejectFor(producer);
    assert.ok(reject, 'expected a generic reject');
    assert.equal(reject.payload.peerId, 'peer-unknown');
    assert.equal(reject.payload.rejectCode, 'T00');
    assert.equal(
      producer.sent.filter(
        (m) => m.msgName === ILPQuoteRequestReceivedEvent.name
      ).length,
      0
    );
  });

  test('an inactive peer yields a generic T00 reject', async () => {
    const { producer, consumer, credentials } = await startedHandler([
      { ...PEER, isActive: false }
    ]);
    await consumer.deliver([inboundProbe(credentials.ilpAddress)]);

    const reject = rejectFor(producer);
    assert.ok(reject, 'expected a generic reject');
    assert.equal(reject.payload.rejectCode, 'T00');
  });

  test('a missing calculated quote yields a generic reject', async () => {
    const { producer, consumer, credentials, fake } = await startedHandler();
    const resolved = await fake.resolveStreamCredentials(
      credentials.ilpAddress
    );
    assert.ok(resolved);
    await consumer.deliver([
      inboundProbe(
        credentials.ilpAddress,
        unfulfillableStreamPrepare(resolved.sharedSecret)
      )
    ]);
    await consumer.deliver([
      new RespondToRemoteQuoteCmd({
        peerId: 'peer-1',
        packetId: 'packet-in-1'
      })
    ]);

    const reject = rejectFor(producer);
    assert.ok(reject, 'expected a generic reject');
    assert.equal(reject.payload.rejectCode, 'T00');
    assert.equal(reject.payload.data, undefined);
  });

  test('the receiving path never touches payment-receiving liquidity logic', async () => {
    const { producer, consumer, credentials, fake } = await startedHandler();
    const resolved = await fake.resolveStreamCredentials(
      credentials.ilpAddress
    );
    assert.ok(resolved);
    await consumer.deliver([
      inboundProbe(
        credentials.ilpAddress,
        unfulfillableStreamPrepare(resolved.sharedSecret)
      )
    ]);
    await consumer.deliver([
      new RespondToRemoteQuoteCmd({
        peerId: 'peer-1',
        packetId: 'packet-in-1',
        destinationAmount: '95'
      })
    ]);

    assert.equal(
      producer.sent.filter((m) => m.msgName === ILPPaymentFailedEvent.name)
        .length,
      0
    );
  });

  test('a verified STREAM payment stores PAYMENT correlation and emits ILPPaymentReceivedEvent', async () => {
    const { producer, consumer, repo, credentials, fake } =
      await startedHandler();
    const resolved = await fake.resolveStreamCredentials(
      credentials.ilpAddress
    );
    assert.ok(resolved);
    const { data, executionCondition } = fulfillablePrepareData(
      resolved!.sharedSecret
    );

    const prepare = inboundProbe(credentials.ilpAddress, {
      packetId: 'packet-pay-1',
      data,
      executionCondition
    });
    await consumer.deliver([prepare]);

    assert.equal(
      producer.sent.filter(
        (m) => m.msgName === ILPQuoteRequestReceivedEvent.name
      ).length,
      0
    );
    assert.equal(
      producer.sent.filter((m) => m.msgName === DispatchRejectPacketCmd.name)
        .length,
      0
    );

    const received = producer.sent.find(
      (m) => m.msgName === ILPPaymentReceivedEvent.name
    ) as ILPPaymentReceivedEvent;
    assert.ok(received);
    assert.equal(received.payload.packetId, 'packet-pay-1');
    assert.equal(received.payload.paymentIntentId, PAYMENT_INTENT_ID);
    assert.equal(received.payload.sourceAmount, '100');
    assert.equal(received.payload.peerId, 'peer-1');
    assert.equal(received.payload.expiresAt, prepare.payload.expiresAt);

    const stored = await repo.fetchPacketById('packet-pay-1');
    assert.ok(stored);
    assert.equal(stored!.kind, 'PAYMENT');
    assert.equal(stored!.paymentIntentId, PAYMENT_INTENT_ID);
    assert.equal(stored!.paymentId, received.payload.paymentId);
    assert.ok(stored!.inboundPrepare);
    assert.equal(stored!.inboundPrepare!.amount, '100');
    assert.equal(stored!.inboundPrepare!.data, data);
  });

  test('expiring an inbound packet marks the correlation EXPIRED', async () => {
    const { producer, consumer, repo, credentials, fake } =
      await startedHandler();
    const resolved = await fake.resolveStreamCredentials(
      credentials.ilpAddress
    );
    assert.ok(resolved);
    const { data, executionCondition } = fulfillablePrepareData(
      resolved!.sharedSecret
    );

    await consumer.deliver([
      inboundProbe(credentials.ilpAddress, {
        packetId: 'packet-expire-1',
        data,
        executionCondition
      })
    ]);

    const pending = await repo.fetchPacketById('packet-expire-1');
    assert.ok(pending, 'expected a packet correlation awaiting Payments');
    assert.equal(pending!.state, 'PENDING');
    assert.ok(pending!.inboundPrepare);

    // Payments never answers and the expiry worker steps in.
    await consumer.deliver([
      new ExpirePacketCmd({
        peerId: 'peer-1',
        packetId: 'packet-expire-1',
        expiredAt: new Date().toISOString()
      })
    ]);

    assert.ok(
      producer.sent.find((m) => m.msgName === ILPPaymentFailedEvent.name),
      'expected the payment to be reported as failed'
    );
    const expired = await repo.fetchPacketById('packet-expire-1');
    assert.ok(expired);
    assert.equal(expired!.state, 'EXPIRED');
  });

  test('invalid STREAM data with resolved destination yields F06', async () => {
    const { producer, consumer, credentials, fake } = await startedHandler();
    const resolved = await fake.resolveStreamCredentials(
      credentials.ilpAddress
    );
    assert.ok(resolved);
    const encryptionKey = hmacSha256(
      resolved!.sharedSecret,
      ENCRYPTION_KEY_STRING
    );
    const data = encryptStreamData(
      encryptionKey,
      Buffer.from('quote-frames')
    ).toString('base64');

    await consumer.deliver([
      inboundProbe(credentials.ilpAddress, {
        data,
        executionCondition: randomBytes(32).toString('base64')
      })
    ]);

    const reject = rejectFor(producer);
    assert.ok(reject, 'expected an F06 reject');
    assert.equal(reject.payload.rejectCode, 'F06');
    assert.equal(
      producer.sent.filter(
        (m) => m.msgName === ILPQuoteRequestReceivedEvent.name
      ).length,
      0
    );
  });

  test('fulfillable inbound payment dispatches STREAM fulfill data and emits sent event', async () => {
    const { producer, consumer, credentials, fake } = await startedHandler();
    const resolved = await fake.resolveStreamCredentials(
      credentials.ilpAddress
    );
    assert.ok(resolved);
    const { data, executionCondition, fulfillment } = fulfillablePrepareData(
      resolved!.sharedSecret
    );

    await consumer.deliver([
      inboundProbe(credentials.ilpAddress, {
        packetId: 'packet-pay-2',
        data,
        executionCondition
      })
    ]);

    const received = producer.sent.find(
      (m) => m.msgName === ILPPaymentReceivedEvent.name
    ) as ILPPaymentReceivedEvent;
    assert.ok(received);
    producer.sent.length = 0;

    await consumer.deliver([
      new FulfillInboundPaymentCmd({
        peerId: 'peer-1',
        packetId: 'packet-pay-2',
        paymentIntentId: PAYMENT_INTENT_ID,
        inboundPaymentId: 'rp-1',
        requestId: received.payload.requestId,
        receiveAmount: '100',
        receiveAssetCode: 'USD',
        receiveAssetScale: 2
      })
    ]);

    const fulfillCmd = producer.sent.find(
      (m) => m.msgName === DispatchFulfillPacketCmd.name
    ) as DispatchFulfillPacketCmd;
    assert.ok(fulfillCmd);
    assert.equal(fulfillCmd.payload.packetId, 'packet-pay-2');
    assert.ok(fulfillCmd.payload.callbackDeadline);
    assert.equal(
      fulfillCmd.payload.fulfillment,
      fulfillment.toString('base64')
    );
    assert.ok(
      fulfillCmd.payload.data,
      'expected encrypted STREAM fulfill data'
    );
    assert.equal(
      decodeStreamPrepareAmount(
        resolved!.sharedSecret,
        Buffer.from(fulfillCmd.payload.data as string, 'base64')
      ),
      '100'
    );

    const sent = producer.sent.find(
      (m) => m.msgName === ILPPaymentFulfillmentSentEvent.name
    ) as ILPPaymentFulfillmentSentEvent;
    assert.ok(sent);
    assert.equal(sent.payload.inboundPaymentId, 'rp-1');
    assert.equal(sent.payload.packetId, 'packet-pay-2');
  });

  test('fulfill after FX puts Payments receive amount in STREAM prepareAmount', async () => {
    const { producer, consumer, credentials, fake } = await startedHandler();
    const resolved = await fake.resolveStreamCredentials(
      credentials.ilpAddress
    );
    assert.ok(resolved);
    const { data, executionCondition, fulfillment } = fulfillablePrepareData(
      resolved!.sharedSecret
    );

    await consumer.deliver([
      inboundProbe(credentials.ilpAddress, {
        packetId: 'packet-pay-fx',
        amount: '100',
        data,
        executionCondition
      })
    ]);
    producer.sent.length = 0;

    await consumer.deliver([
      new FulfillInboundPaymentCmd({
        peerId: 'peer-1',
        packetId: 'packet-pay-fx',
        paymentIntentId: PAYMENT_INTENT_ID,
        inboundPaymentId: 'rp-fx',
        requestId: crypto.randomUUID(),
        receiveAmount: '95',
        receiveAssetCode: 'EUR',
        receiveAssetScale: 2
      })
    ]);

    const fulfillCmd = producer.sent.find(
      (m) => m.msgName === DispatchFulfillPacketCmd.name
    ) as DispatchFulfillPacketCmd;
    assert.ok(fulfillCmd);
    assert.equal(
      fulfillCmd.payload.fulfillment,
      fulfillment.toString('base64')
    );
    const decoded = decodeStreamReply(
      resolved!.sharedSecret,
      Buffer.from(fulfillCmd.payload.data as string, 'base64')
    );
    assert.equal(decoded?.prepareAmount, '95');
    assert.equal(decoded?.assetCode, 'EUR');
    assert.equal(decoded?.assetScale, 2);
    assert.equal(decoded?.connectionClosed, false);
  });

  test('a fulfill with no resolvable credentials omits STREAM data', async () => {
    const fake = createFakeResolveStreamCredentials();
    const inner = fake.resolveStreamCredentials.bind(fake);
    let resolves = 0;
    fake.resolveStreamCredentials = async (address) => {
      const resolved = await inner(address);
      resolves += 1;
      return resolves === 1 ? resolved : undefined;
    };
    const { producer, consumer, credentials } = await startedHandler(
      [PEER],
      fake
    );
    assert.ok(credentials);
    const resolved = await inner(credentials.ilpAddress);
    assert.ok(resolved);
    const { data, executionCondition, fulfillment } = fulfillablePrepareData(
      resolved.sharedSecret
    );

    await consumer.deliver([
      inboundProbe(credentials.ilpAddress, {
        packetId: 'packet-pay-no-secret',
        data,
        executionCondition
      })
    ]);
    producer.sent.length = 0;

    await consumer.deliver([
      new FulfillInboundPaymentCmd({
        peerId: 'peer-1',
        packetId: 'packet-pay-no-secret',
        paymentIntentId: PAYMENT_INTENT_ID,
        inboundPaymentId: 'rp-no-secret',
        requestId: crypto.randomUUID(),
        receiveAmount: '95',
        receiveAssetCode: 'EUR',
        receiveAssetScale: 2
      })
    ]);

    const fulfillCmd = producer.sent.find(
      (m) => m.msgName === DispatchFulfillPacketCmd.name
    ) as DispatchFulfillPacketCmd;
    assert.ok(fulfillCmd);
    assert.equal(
      fulfillCmd.payload.fulfillment,
      fulfillment.toString('base64')
    );
    assert.equal(fulfillCmd.payload.data, undefined);
  });

  test('Payments fulfill after the prepare clock has passed still dispatches a wire fulfill', async () => {
    const { producer, consumer, repo, credentials, fake } =
      await startedHandler();
    const resolved = await fake.resolveStreamCredentials(
      credentials.ilpAddress
    );
    assert.ok(resolved);
    const { data, fulfillment, executionCondition } = fulfillablePrepareData(
      resolved!.sharedSecret
    );

    await consumer.deliver([
      inboundProbe(credentials.ilpAddress, {
        packetId: 'packet-pay-expired',
        data,
        executionCondition
      })
    ]);
    const stored = await repo.fetchPacketById('packet-pay-expired');
    assert.ok(stored);
    await repo.updatePacket({
      ...stored,
      expiresAt: new Date(Date.now() - 1_000)
    });
    producer.sent.length = 0;

    await consumer.deliver([
      new FulfillInboundPaymentCmd({
        peerId: 'peer-1',
        packetId: 'packet-pay-expired',
        paymentIntentId: PAYMENT_INTENT_ID,
        inboundPaymentId: 'rp-expired',
        requestId: stored.requestId,
        receiveAmount: '100',
        receiveAssetCode: 'USD',
        receiveAssetScale: 2
      })
    ]);

    const fulfillCmd = producer.sent.find(
      (m) => m.msgName === DispatchFulfillPacketCmd.name
    ) as DispatchFulfillPacketCmd;
    assert.ok(fulfillCmd);
    assert.equal(
      fulfillCmd.payload.fulfillment,
      fulfillment.toString('base64')
    );
    assert.equal(
      producer.sent.filter(
        (m) => m.msgName === ILPPaymentFulfillmentFailedEvent.name
      ).length,
      0
    );
    const after = await repo.fetchPacketById('packet-pay-expired');
    assert.equal(after?.state, 'FULFILLED');
  });

  test('a peer closing the connection is rejected, not read as a quote probe', async () => {
    const { producer, consumer, repo, credentials, fake } =
      await startedHandler();
    const resolved = await fake.resolveStreamCredentials(
      credentials.ilpAddress
    );
    assert.ok(resolved);

    await consumer.deliver([
      inboundProbe(credentials.ilpAddress, {
        packetId: 'packet-closed',
        ...connectionClosePrepare(resolved!.sharedSecret)
      })
    ]);

    // stream-receiver answers a ConnectionClose with F99 — the same code we use
    // for a quote answer — so routing on the code alone invents a phantom quote.
    assert.equal(
      producer.sent.filter(
        (m) => m.msgName === ILPQuoteRequestReceivedEvent.name
      ).length,
      0
    );
    const reject = rejectFor(producer);
    assert.ok(reject, 'expected the close to be rejected back to the peer');
    assert.equal(reject.payload.rejectCode, 'F99');
    assert.equal(
      await repo.fetchPacketById('packet-closed'),
      undefined,
      'a closed connection must not leave a packet awaiting Payments'
    );
  });

  test('reject inbound payment keeps the reject code Payments chose', async () => {
    const { producer, consumer, credentials, fake } = await startedHandler();
    const resolved = await fake.resolveStreamCredentials(
      credentials.ilpAddress
    );
    assert.ok(resolved);
    const { data, executionCondition } = fulfillablePrepareData(
      resolved!.sharedSecret
    );

    await consumer.deliver([
      inboundProbe(credentials.ilpAddress, {
        packetId: 'packet-pay-final',
        data,
        executionCondition
      })
    ]);
    producer.sent.length = 0;

    await consumer.deliver([
      new RejectInboundPaymentCmd({
        peerId: 'peer-1',
        packetId: 'packet-pay-final',
        paymentIntentId: PAYMENT_INTENT_ID,
        inboundPaymentId: 'rp-fail-2',
        requestId: crypto.randomUUID(),
        rejectCode: 'F06',
        rejectMessage: 'receiver refused'
      })
    ]);

    const reject = rejectFor(producer);
    assert.ok(reject);
    // Not collapsed into temporaryDecline's hardcoded T00.
    assert.equal(reject.payload.rejectCode, 'F06');
    assert.ok(reject.payload.data, 'expected encrypted STREAM reject data');
  });

  test('fulfill inbound payment fails when packet correlation is missing', async () => {
    const { producer, consumer } = await startedHandler();

    await consumer.deliver([
      new FulfillInboundPaymentCmd({
        peerId: 'peer-1',
        packetId: 'missing-packet',
        paymentIntentId: PAYMENT_INTENT_ID,
        inboundPaymentId: 'rp-missing',
        requestId: crypto.randomUUID(),
        receiveAmount: '100',
        receiveAssetCode: 'USD',
        receiveAssetScale: 2
      })
    ]);

    const failed = producer.sent.find(
      (m) => m.msgName === ILPPaymentFulfillmentFailedEvent.name
    ) as ILPPaymentFulfillmentFailedEvent;
    assert.ok(failed);
    assert.equal(failed.payload.reason, 'packet_not_found');
    assert.equal(
      producer.sent.filter((m) => m.msgName === DispatchFulfillPacketCmd.name)
        .length,
      0
    );
  });

  test('reject inbound payment dispatches T00 and marks the packet REJECTED', async () => {
    const { producer, consumer, repo, credentials, fake } =
      await startedHandler();
    const resolved = await fake.resolveStreamCredentials(
      credentials.ilpAddress
    );
    assert.ok(resolved);
    const { data, executionCondition } = fulfillablePrepareData(
      resolved!.sharedSecret
    );

    await consumer.deliver([
      inboundProbe(credentials.ilpAddress, {
        packetId: 'packet-pay-reject',
        data,
        executionCondition
      })
    ]);

    const pending = await repo.fetchPacketById('packet-pay-reject');
    assert.ok(pending?.inboundPrepare);
    producer.sent.length = 0;

    await consumer.deliver([
      new RejectInboundPaymentCmd({
        peerId: 'peer-1',
        packetId: 'packet-pay-reject',
        paymentIntentId: PAYMENT_INTENT_ID,
        inboundPaymentId: 'rp-fail-1',
        requestId: crypto.randomUUID(),
        rejectMessage: 'Ledger transfer failed'
      })
    ]);

    const reject = producer.sent.find(
      (m) => m.msgName === DispatchRejectPacketCmd.name
    ) as DispatchRejectPacketCmd;
    assert.ok(reject);
    assert.equal(reject.payload.packetId, 'packet-pay-reject');
    assert.equal(reject.payload.rejectCode, 'T00');
    assert.ok(reject.payload.data, 'expected STREAM reject data after accept');
    assert.equal(
      decodeStreamPrepareAmount(
        resolved!.sharedSecret,
        Buffer.from(reject.payload.data as string, 'base64')
      ),
      '100'
    );
    const stored = await repo.fetchPacketById('packet-pay-reject');
    assert.ok(stored);
    assert.equal(stored.state, 'REJECTED');
  });
});
