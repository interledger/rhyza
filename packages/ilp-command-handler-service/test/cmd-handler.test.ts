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
  ActivatePeerCmd,
  CreatePeerCmd,
  DeactivatePeerCmd,
  DispatchPreparePacketCmd,
  DispatchRejectPacketCmd,
  ExpirePacketCmd,
  createFakeResolveStreamCredentials,
  type IncomingMoney,
  StreamServer,
  IlpPeerAggregate,
  ILPPeerCreatedEvent,
  ILPPeerCreationFailedEvent,
  ILPPeerUpdatedEvent,
  ILPPeerUpdateFailedEvent,
  IPeer,
  IPeeringClient,
  PacketDispatch,
  ProcessPreparePacketCmd,
  ProcessRejectPacketCmd,
  ILPQuoteReceivedEvent,
  ILPQuoteFailedEvent,
  ILPPaymentFailedEvent,
  ILPPaymentConfirmedEvent,
  StartRemotePaymentCmd,
  StartRemoteQuoteCmd,
  ProcessFulfillPacketCmd,
  UpdatePeerCmd,
  encodeStreamQuoteReply,
  encodeStreamFulfillReply,
  encryptStreamData,
  hmacSha256,
  ENCRYPTION_KEY_STRING
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
  http: {
    outgoing: {
      endpoint: 'https://peer.example/ilp',
      callbackEndpoint: 'https://peer.example/ilp/callback',
      authToken: 't'
    }
  },
  isActive: true
};

const TEST_QUOTE_SECRET = Buffer.alloc(32, 7).toString('base64url');

function isIncomingMoney(reply: { accept?: unknown }): reply is IncomingMoney {
  return typeof reply.accept === 'function';
}

function createRemoteReceiver() {
  const streamServer = new StreamServer({
    serverSecret: randomBytes(32),
    serverAddress: 'g.peer.bob'
  });
  const credentials = streamServer.generateCredentials({
    paymentTag: 'remote'
  });
  return { streamServer, credentials };
}

function createReplyForDispatch(
  streamServer: StreamServer,
  destination: string,
  dispatch: {
    payload: {
      amount: string;
      expiresAt: string;
      executionCondition: string;
      data?: string;
    };
  }
) {
  return streamServer.createReply({
    destination,
    amount: dispatch.payload.amount,
    expiresAt: new Date(dispatch.payload.expiresAt),
    executionCondition: Buffer.from(
      dispatch.payload.executionCondition,
      'base64'
    ),
    data: Buffer.from(dispatch.payload.data as string, 'base64')
  });
}

const startQuote = () =>
  new StartRemoteQuoteCmd(
    {
      peerId: 'peer-1',
      paymentIntentId: 'intent-1',
      quoteId: 'quote-1',
      destinationIlpAddress: 'g.peer.bob',
      sourceAmount: '100',
      sourceAssetCode: 'USD',
      sourceAssetScale: 2,
      sharedSecret: TEST_QUOTE_SECRET
    },
    'req-1'
  );

async function startedHandler() {
  const producer = new MockProducer();
  const consumer = new MockConsumer();
  const repo = new InMemoryPeerRepository([PEER]);
  const peeringClient = new KafkaPeeringClient(producer, new ConsoleLogger());
  const fake = createFakeResolveStreamCredentials();
  const aggregate = new IlpPeerAggregate(
    repo,
    peeringClient,
    fake.resolveStreamCredentials,
    fake.streamServer
  );
  const handler = new IlpCommandHandler(
    consumer,
    producer,
    aggregate,
    new ConsoleLogger()
  );
  await handler.start();
  return { producer, consumer, repo };
}

const dispatchedPacketId = (producer: MockProducer): string => {
  const dispatch = producer.sent.find(
    (m) => m.msgName === DispatchPreparePacketCmd.name
  ) as DispatchPreparePacketCmd | undefined;
  assert.ok(dispatch, 'expected a DispatchPreparePacketCmd to be produced');
  return dispatch.payload.packetId;
};

describe('IlpCommandHandler — peer creation/update', () => {
  test('CreatePeerCmd for a new peer yields ILPPeerCreatedEvent and the peer becomes resolvable', async () => {
    const { producer, consumer } = await startedHandler();

    await consumer.deliver([
      new CreatePeerCmd(
        {
          peerId: 'peer-new',
          http: {
            outgoing: {
              endpoint: 'https://new-peer.example/ilp',
              callbackEndpoint: 'https://new-peer.example/ilp/callback',
              authToken: 't'
            }
          },
          isActive: true
        },
        'req-create-1'
      )
    ]);

    const event = producer.sent.find(
      (m) => m.msgName === ILPPeerCreatedEvent.name
    ) as ILPPeerCreatedEvent;
    assert.ok(event, 'expected a ILPPeerCreatedEvent');
    assert.equal(event.payload.peerId, 'peer-new');
    assert.equal(event.requestId, 'req-create-1');

    // The newly created peer is now resolvable by a subsequent command.
    await consumer.deliver([
      new StartRemoteQuoteCmd(
        {
          peerId: 'peer-new',
          paymentIntentId: 'intent-2',
          quoteId: 'quote-2',
          destinationIlpAddress: 'g.peer.bob',
          sourceAmount: '50',
          sourceAssetCode: 'USD',
          sourceAssetScale: 2,
          sharedSecret: TEST_QUOTE_SECRET
        },
        'req-2'
      )
    ]);
    const dispatch = producer.sent.find(
      (m) =>
        m.msgName === DispatchPreparePacketCmd.name &&
        (m as DispatchPreparePacketCmd).msgKey === 'peer-new'
    );
    assert.ok(dispatch, 'expected the new peer to be resolvable');
  });

  test('CreatePeerCmd for an existing peer yields ILPPeerCreationFailedEvent', async () => {
    const { producer, consumer } = await startedHandler();

    await consumer.deliver([
      new CreatePeerCmd(
        {
          peerId: 'peer-1',
          http: {
            outgoing: {
              endpoint: 'https://peer.example/ilp',
              callbackEndpoint: 'https://peer.example/ilp/callback',
              authToken: 't'
            }
          }
        },
        'req-create-dup'
      )
    ]);

    const event = producer.sent.find(
      (m) => m.msgName === ILPPeerCreationFailedEvent.name
    ) as ILPPeerCreationFailedEvent;
    assert.ok(event, 'expected a ILPPeerCreationFailedEvent');
    assert.equal(event.payload.errorName, 'DuplicatePeer');
    assert.equal(event.isErrorEvent, true);
    assert.equal(event.requestId, 'req-create-dup');
  });

  test('UpdatePeerCmd for an existing peer yields ILPPeerUpdatedEvent', async () => {
    const { producer, consumer } = await startedHandler();

    await consumer.deliver([
      new UpdatePeerCmd(
        {
          peerId: 'peer-1',
          http: {
            outgoing: {
              endpoint: 'https://peer.example/ilp-v2',
              callbackEndpoint: 'https://peer.example/ilp/callback',
              authToken: 't2'
            }
          },
          isActive: false
        },
        'req-update-1'
      )
    ]);

    const event = producer.sent.find(
      (m) => m.msgName === ILPPeerUpdatedEvent.name
    ) as ILPPeerUpdatedEvent;
    assert.ok(event, 'expected a ILPPeerUpdatedEvent');
    assert.equal(
      event.payload.http.outgoing.endpoint,
      'https://peer.example/ilp-v2'
    );
    assert.equal(event.payload.isActive, false);
    assert.equal(event.requestId, 'req-update-1');
  });

  test('UpdatePeerCmd for an unknown peer yields ILPPeerUpdateFailedEvent', async () => {
    const { producer, consumer } = await startedHandler();

    await consumer.deliver([
      new UpdatePeerCmd(
        {
          peerId: 'peer-does-not-exist',
          http: {
            outgoing: {
              endpoint: 'https://peer.example/ilp',
              callbackEndpoint: 'https://peer.example/ilp/callback',
              authToken: 't'
            }
          }
        },
        'req-update-unknown'
      )
    ]);

    const event = producer.sent.find(
      (m) => m.msgName === ILPPeerUpdateFailedEvent.name
    ) as ILPPeerUpdateFailedEvent;
    assert.ok(event, 'expected a ILPPeerUpdateFailedEvent');
    assert.equal(event.payload.errorName, 'UnknownPeer');
    assert.equal(event.isErrorEvent, true);
    assert.equal(event.requestId, 'req-update-unknown');
  });
});

describe('IlpCommandHandler — peer activation mirror', () => {
  test('DeactivatePeerCmd for an existing peer flips isActive to false', async () => {
    const { producer, consumer } = await startedHandler();

    await consumer.deliver([
      new DeactivatePeerCmd({ peerId: 'peer-1' }, 'req-deactivate-1')
    ]);

    const event = producer.sent.find(
      (m) => m.msgName === ILPPeerUpdatedEvent.name
    ) as ILPPeerUpdatedEvent;
    assert.ok(event, 'expected a ILPPeerUpdatedEvent');
    assert.equal(event.payload.peerId, 'peer-1');
    assert.equal(event.payload.isActive, false);
    assert.equal(event.requestId, 'req-deactivate-1');

    // A deactivated peer's inbound prepares are rejected generically instead
    // of being decoded/routed
    await consumer.deliver([
      new ProcessPreparePacketCmd({
        peerId: 'peer-1',
        packetId: 'packet-1',
        destinationIlpAddress: 'g.us.alice',
        amount: '100',
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        executionCondition: Buffer.alloc(32).toString('base64')
      })
    ]);
    const dispatch = producer.sent.find(
      (m) => m.msgName === DispatchRejectPacketCmd.name
    ) as DispatchRejectPacketCmd | undefined;
    assert.ok(dispatch, 'expected the inbound prepare to be rejected');
    assert.equal(dispatch.payload.rejectCode, 'T00');
  });

  test('ActivatePeerCmd for an existing peer flips isActive to true', async () => {
    const { producer, consumer } = await startedHandler();

    await consumer.deliver([
      new DeactivatePeerCmd({ peerId: 'peer-1' }, 'req-deactivate-2')
    ]);
    await consumer.deliver([
      new ActivatePeerCmd({ peerId: 'peer-1' }, 'req-activate-1')
    ]);

    const events = producer.sent.filter(
      (m) => m.msgName === ILPPeerUpdatedEvent.name
    ) as ILPPeerUpdatedEvent[];
    const activated = events.at(-1);
    assert.ok(activated, 'expected a ILPPeerUpdatedEvent');
    assert.equal(activated.payload.isActive, true);
    assert.equal(activated.requestId, 'req-activate-1');
  });

  test('DeactivatePeerCmd for an unknown peer yields ILPPeerUpdateFailedEvent', async () => {
    const { producer, consumer } = await startedHandler();

    await consumer.deliver([
      new DeactivatePeerCmd(
        { peerId: 'peer-does-not-exist' },
        'req-deactivate-unknown'
      )
    ]);

    const event = producer.sent.find(
      (m) => m.msgName === ILPPeerUpdateFailedEvent.name
    ) as ILPPeerUpdateFailedEvent;
    assert.ok(event, 'expected a ILPPeerUpdateFailedEvent');
    assert.equal(event.payload.errorName, 'UnknownPeer');
    assert.equal(event.isErrorEvent, true);
    assert.equal(event.requestId, 'req-deactivate-unknown');
  });
});

describe('IlpCommandHandler — remote payment sending', () => {
  test('a StartRemotePaymentCmd with no shared secret fails without poisoning the batch', async () => {
    const { producer, consumer } = await startedHandler();
    const sharedSecret = Buffer.alloc(32, 9).toString('base64url');

    await consumer.deliver([
      new StartRemotePaymentCmd(
        {
          peerId: 'peer-1',
          paymentIntentId: 'intent-1',
          paymentId: 'pay-missing',
          destinationIlpAddress: 'g.peer.bob',
          amount: '100',
          assetCode: 'USD',
          assetScale: 2,
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
          sharedSecret: ''
        },
        'req-pay-missing'
      ),
      new StartRemotePaymentCmd(
        {
          peerId: 'peer-1',
          paymentIntentId: 'intent-2',
          paymentId: 'pay-ok',
          destinationIlpAddress: 'g.peer.bob',
          amount: '50',
          assetCode: 'USD',
          assetScale: 2,
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
          sharedSecret
        },
        'req-pay-ok'
      )
    ]);

    const failed = producer.sent.find(
      (m) => m.msgName === ILPPaymentFailedEvent.name
    ) as ILPPaymentFailedEvent;
    assert.ok(failed, 'expected ILPPaymentFailedEvent');
    assert.equal(failed.payload.paymentId, 'pay-missing');
    assert.equal(failed.payload.reason, 'REJECTED');
    assert.equal(failed.requestId, 'req-pay-missing');

    const dispatch = producer.sent.find(
      (m) =>
        m.msgName === DispatchPreparePacketCmd.name &&
        (m as DispatchPreparePacketCmd).payload.paymentIntentId === 'intent-2'
    ) as DispatchPreparePacketCmd;
    assert.ok(
      dispatch,
      'sibling command in the same batch must still dispatch'
    );
  });

  test('a StartRemotePaymentCmd for an unknown peer fails without poisoning the batch', async () => {
    const { producer, consumer } = await startedHandler();
    const sharedSecret = Buffer.alloc(32, 9).toString('base64url');

    await consumer.deliver([
      new StartRemotePaymentCmd(
        {
          peerId: 'peer-missing',
          paymentIntentId: 'intent-1',
          paymentId: 'pay-missing-peer',
          destinationIlpAddress: 'g.peer.bob',
          amount: '100',
          assetCode: 'USD',
          assetScale: 2,
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
          sharedSecret
        },
        'req-pay-unknown-peer'
      ),
      new StartRemotePaymentCmd(
        {
          peerId: 'peer-1',
          paymentIntentId: 'intent-2',
          paymentId: 'pay-ok',
          destinationIlpAddress: 'g.peer.bob',
          amount: '50',
          assetCode: 'USD',
          assetScale: 2,
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
          sharedSecret
        },
        'req-pay-ok'
      )
    ]);

    const failed = producer.sent.find(
      (m) => m.msgName === ILPPaymentFailedEvent.name
    ) as ILPPaymentFailedEvent;
    assert.ok(failed, 'expected ILPPaymentFailedEvent');
    assert.equal(failed.payload.paymentId, 'pay-missing-peer');
    assert.equal(failed.payload.peerId, 'peer-missing');
    assert.equal(failed.payload.reason, 'REJECTED');
    assert.equal(failed.requestId, 'req-pay-unknown-peer');

    const dispatch = producer.sent.find(
      (m) =>
        m.msgName === DispatchPreparePacketCmd.name &&
        (m as DispatchPreparePacketCmd).payload.paymentIntentId === 'intent-2'
    ) as DispatchPreparePacketCmd;
    assert.ok(
      dispatch,
      'sibling command in the same batch must still dispatch'
    );
  });

  test('starting a remote payment dispatches a prepare to the connector', async () => {
    const { producer, consumer } = await startedHandler();
    const sharedSecret = Buffer.alloc(32, 9).toString('base64url');

    await consumer.deliver([
      new StartRemotePaymentCmd(
        {
          peerId: 'peer-1',
          paymentIntentId: 'intent-1',
          paymentId: 'pay-1',
          destinationIlpAddress: 'g.peer.bob',
          amount: '100',
          assetCode: 'USD',
          assetScale: 2,
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
          sharedSecret
        },
        'req-pay-1'
      )
    ]);

    const dispatch = producer.sent.find(
      (m) => m.msgName === DispatchPreparePacketCmd.name
    ) as DispatchPreparePacketCmd;
    assert.ok(dispatch);
    assert.equal(dispatch.msgTopic, 'ilp-connector-commands');
    assert.equal(dispatch.msgKey, 'peer-1');
    assert.equal(dispatch.payload.paymentIntentId, 'intent-1');
    assert.equal(dispatch.payload.amount, '100');
  });

  test('StartRemotePaymentCmd dispatches a STREAM-verifiable execution condition', async () => {
    const { producer, consumer } = await startedHandler();
    const { streamServer, credentials } = createRemoteReceiver();
    const sharedSecret = credentials.sharedSecret.toString('base64url');

    await consumer.deliver([
      new StartRemotePaymentCmd(
        {
          peerId: 'peer-1',
          paymentIntentId: 'intent-1',
          paymentId: 'pay-1',
          destinationIlpAddress: credentials.ilpAddress,
          amount: '100',
          assetCode: 'USD',
          assetScale: 2,
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
          sharedSecret
        },
        'req-pay-1'
      )
    ]);

    const dispatch = producer.sent.find(
      (m) => m.msgName === DispatchPreparePacketCmd.name
    ) as DispatchPreparePacketCmd;
    assert.ok(dispatch);
    assert.ok(dispatch.payload.data, 'expected STREAM packet data');

    const reply = createReplyForDispatch(
      streamServer,
      credentials.ilpAddress,
      dispatch
    );
    assert.ok(isIncomingMoney(reply));
  });

  async function startRemotePayment(
    consumer: MockConsumer,
    producer: MockProducer,
    expiresAt = new Date(Date.now() + 30_000).toISOString()
  ) {
    const { streamServer, credentials } = createRemoteReceiver();
    await consumer.deliver([
      new StartRemotePaymentCmd(
        {
          peerId: 'peer-1',
          paymentIntentId: 'intent-1',
          paymentId: 'pay-1',
          destinationIlpAddress: credentials.ilpAddress,
          amount: '100',
          assetCode: 'USD',
          assetScale: 2,
          expiresAt,
          sharedSecret: credentials.sharedSecret.toString('base64url')
        },
        'req-pay-1'
      )
    ]);
    const dispatch = producer.sent.find(
      (m) => m.msgName === DispatchPreparePacketCmd.name
    ) as DispatchPreparePacketCmd;
    assert.ok(dispatch);
    const reply = createReplyForDispatch(
      streamServer,
      credentials.ilpAddress,
      dispatch
    );
    assert.ok(isIncomingMoney(reply));
    const sharedSecret = credentials.sharedSecret.toString('base64url');
    return {
      dispatch,
      fulfillment: reply.accept().fulfillment.toString('base64'),
      sharedSecret,
      prepareData: dispatch.payload.data as string
    };
  }

  test('outbound payment correlation stores the execution condition', async () => {
    const { producer, consumer, repo } = await startedHandler();
    const { dispatch } = await startRemotePayment(consumer, producer);
    const stored = await repo.fetchPacketById(dispatch.payload.packetId);
    assert.ok(stored);
    assert.equal(stored!.kind, 'PAYMENT');
    assert.equal(
      stored!.executionCondition,
      dispatch.payload.executionCondition
    );
  });

  test('outbound payment correlation stores the STREAM shared secret', async () => {
    const { producer, consumer, repo } = await startedHandler();
    const { dispatch, sharedSecret } = await startRemotePayment(
      consumer,
      producer
    );
    const stored = await repo.fetchPacketById(dispatch.payload.packetId);
    assert.ok(stored && stored.kind === 'PAYMENT');
    assert.equal(stored.sharedSecret, sharedSecret);
  });

  test('a matching outbound fulfill yields ILPPaymentConfirmedEvent', async () => {
    const { producer, consumer } = await startedHandler();
    const { dispatch, fulfillment } = await startRemotePayment(
      consumer,
      producer
    );
    producer.sent.length = 0;

    await consumer.deliver([
      new ProcessFulfillPacketCmd({
        peerId: 'peer-1',
        paymentIntentId: 'intent-1',
        packetId: dispatch.payload.packetId,
        fulfilledAt: new Date().toISOString(),
        fulfillment
      })
    ]);

    const confirmed = producer.sent.find(
      (m) => m.msgName === ILPPaymentConfirmedEvent.name
    ) as ILPPaymentConfirmedEvent;
    assert.ok(confirmed);
    assert.equal(confirmed.payload.paymentId, 'pay-1');
    assert.equal(
      producer.sent.filter((m) => m.msgName === ILPPaymentFailedEvent.name)
        .length,
      0
    );
  });

  test('a confirmed payment leaves no shared secret behind in the store', async () => {
    const { producer, consumer, repo } = await startedHandler();
    const { dispatch, fulfillment, sharedSecret } = await startRemotePayment(
      consumer,
      producer
    );
    const pending = await repo.fetchPacketById(dispatch.payload.packetId);
    assert.equal(pending?.sharedSecret, sharedSecret);

    await consumer.deliver([
      new ProcessFulfillPacketCmd({
        peerId: 'peer-1',
        paymentIntentId: 'intent-1',
        packetId: dispatch.payload.packetId,
        fulfilledAt: new Date().toISOString(),
        fulfillment
      })
    ]);

    const terminal = await repo.fetchPacketById(dispatch.payload.packetId);
    assert.ok(terminal && terminal.kind === 'PAYMENT');
    assert.equal(terminal.state, 'FULFILLED');
    assert.equal(
      terminal.sharedSecret,
      undefined,
      'a terminal correlation must not keep a live STREAM key at rest'
    );
  });

  test('a STREAM fulfill round-trips destination amount onto ILPPaymentConfirmedEvent', async () => {
    const { producer, consumer } = await startedHandler();
    const { dispatch, fulfillment, sharedSecret, prepareData } =
      await startRemotePayment(consumer, producer);
    producer.sent.length = 0;

    const replyData = encodeStreamFulfillReply({
      sharedSecret: Buffer.from(sharedSecret, 'base64url'),
      prepareData: Buffer.from(prepareData, 'base64'),
      prepareAmount: '95',
      assetCode: 'EUR',
      assetScale: 2
    });
    assert.ok(replyData);

    await consumer.deliver([
      new ProcessFulfillPacketCmd({
        peerId: 'peer-1',
        paymentIntentId: 'intent-1',
        packetId: dispatch.payload.packetId,
        fulfilledAt: new Date().toISOString(),
        fulfillment,
        data: replyData!.toString('base64')
      })
    ]);

    const confirmed = producer.sent.find(
      (m) => m.msgName === ILPPaymentConfirmedEvent.name
    ) as ILPPaymentConfirmedEvent;
    assert.ok(confirmed);
    assert.equal(confirmed.payload.destinationAmount, '95');
    assert.equal(confirmed.payload.destinationAssetCode, 'EUR');
    assert.equal(confirmed.payload.destinationAssetScale, 2);
  });

  test('a fulfill without STREAM data still confirms the payment', async () => {
    const { producer, consumer } = await startedHandler();
    const { dispatch, fulfillment } = await startRemotePayment(
      consumer,
      producer
    );
    producer.sent.length = 0;

    await consumer.deliver([
      new ProcessFulfillPacketCmd({
        peerId: 'peer-1',
        paymentIntentId: 'intent-1',
        packetId: dispatch.payload.packetId,
        fulfilledAt: new Date().toISOString(),
        fulfillment
      })
    ]);

    const confirmed = producer.sent.find(
      (m) => m.msgName === ILPPaymentConfirmedEvent.name
    ) as ILPPaymentConfirmedEvent;
    assert.ok(confirmed);
    assert.equal(confirmed.payload.destinationAmount, undefined);
    assert.equal(
      producer.sent.filter((m) => m.msgName === ILPPaymentFailedEvent.name)
        .length,
      0
    );
  });

  test('undecryptable fulfill data still confirms the payment', async () => {
    const { producer, consumer } = await startedHandler();
    const { dispatch, fulfillment } = await startRemotePayment(
      consumer,
      producer
    );
    producer.sent.length = 0;

    await consumer.deliver([
      new ProcessFulfillPacketCmd({
        peerId: 'peer-1',
        paymentIntentId: 'intent-1',
        packetId: dispatch.payload.packetId,
        fulfilledAt: new Date().toISOString(),
        fulfillment,
        data: Buffer.from('not-stream').toString('base64')
      })
    ]);

    const confirmed = producer.sent.find(
      (m) => m.msgName === ILPPaymentConfirmedEvent.name
    ) as ILPPaymentConfirmedEvent;
    assert.ok(confirmed);
    assert.equal(confirmed.payload.destinationAmount, undefined);
  });

  test('a mismatched outbound fulfill does not confirm the payment', async () => {
    const { producer, consumer } = await startedHandler();
    const { dispatch } = await startRemotePayment(consumer, producer);
    producer.sent.length = 0;

    await consumer.deliver([
      new ProcessFulfillPacketCmd({
        peerId: 'peer-1',
        paymentIntentId: 'intent-1',
        packetId: dispatch.payload.packetId,
        fulfilledAt: new Date().toISOString(),
        fulfillment: Buffer.alloc(32, 1).toString('base64')
      })
    ]);

    assert.equal(
      producer.sent.filter((m) => m.msgName === ILPPaymentConfirmedEvent.name)
        .length,
      0
    );
    const failed = producer.sent.find(
      (m) => m.msgName === ILPPaymentFailedEvent.name
    ) as ILPPaymentFailedEvent;
    assert.ok(failed);
    assert.equal(failed.payload.reason, 'REJECTED');
  });

  test('a late outbound fulfill does not confirm the payment', async () => {
    const { producer, consumer } = await startedHandler();
    const { dispatch, fulfillment } = await startRemotePayment(
      consumer,
      producer,
      new Date(Date.now() - 1000).toISOString()
    );
    producer.sent.length = 0;

    await consumer.deliver([
      new ProcessFulfillPacketCmd({
        peerId: 'peer-1',
        paymentIntentId: 'intent-1',
        packetId: dispatch.payload.packetId,
        fulfilledAt: new Date().toISOString(),
        fulfillment
      })
    ]);

    assert.equal(
      producer.sent.filter((m) => m.msgName === ILPPaymentConfirmedEvent.name)
        .length,
      0
    );
    const failed = producer.sent.find(
      (m) => m.msgName === ILPPaymentFailedEvent.name
    ) as ILPPaymentFailedEvent;
    assert.ok(failed);
    assert.equal(failed.payload.reason, 'EXPIRED');
  });

  test('StartRemotePaymentCmd passes sharedSecret and STREAM fields on PaymentDispatch', async () => {
    const dispatches: PacketDispatch[] = [];
    const peeringClient: IPeeringClient = {
      async dispatch(input) {
        dispatches.push(input);
      },
      async dispatchReject() {},
      async dispatchFulfill() {}
    };

    const producer = new MockProducer();
    const consumer = new MockConsumer();
    const repo = new InMemoryPeerRepository([PEER]);
    const fake = createFakeResolveStreamCredentials();
    const aggregate = new IlpPeerAggregate(
      repo,
      peeringClient,
      fake.resolveStreamCredentials,
      fake.streamServer
    );
    const handler = new IlpCommandHandler(
      consumer,
      producer,
      aggregate,
      new ConsoleLogger()
    );
    await handler.start();

    const { streamServer, credentials } = createRemoteReceiver();
    const sharedSecret = credentials.sharedSecret.toString('base64url');
    await consumer.deliver([
      new StartRemotePaymentCmd(
        {
          peerId: 'peer-1',
          paymentIntentId: 'intent-1',
          paymentId: 'pay-1',
          destinationIlpAddress: credentials.ilpAddress,
          amount: '100',
          assetCode: 'USD',
          assetScale: 2,
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
          sharedSecret
        },
        'req-pay-1'
      )
    ]);

    assert.equal(dispatches.length, 1);
    assert.equal(dispatches[0].type, 'PAYMENT');
    if (dispatches[0].type === 'PAYMENT') {
      assert.equal(dispatches[0].sharedSecret, sharedSecret);
      assert.equal(dispatches[0].paymentId, 'pay-1');
      assert.ok(dispatches[0].executionCondition);
      assert.ok(dispatches[0].data);
      const reply = streamServer.createReply({
        destination: credentials.ilpAddress,
        amount: '100',
        expiresAt: new Date(Date.now() + 30_000),
        executionCondition: Buffer.from(
          dispatches[0].executionCondition,
          'base64'
        ),
        data: Buffer.from(dispatches[0].data, 'base64')
      });
      assert.ok(isIncomingMoney(reply));
    }
  });

  test('a peer reject on a payment yields ILPPaymentFailedEvent with rejectCode', async () => {
    const { producer, consumer } = await startedHandler();
    const sharedSecret = Buffer.alloc(32, 9).toString('base64url');

    await consumer.deliver([
      new StartRemotePaymentCmd(
        {
          peerId: 'peer-1',
          paymentIntentId: 'intent-1',
          paymentId: 'pay-1',
          destinationIlpAddress: 'g.peer.bob',
          amount: '100',
          assetCode: 'USD',
          assetScale: 2,
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
          sharedSecret
        },
        'req-pay-1'
      )
    ]);
    const packetId = dispatchedPacketId(producer);

    await consumer.deliver([
      new ProcessRejectPacketCmd({
        peerId: 'peer-1',
        paymentIntentId: 'intent-1',
        packetId,
        rejectCode: 'F06',
        rejectMessage: 'unexpected payment',
        rejectedAt: new Date().toISOString()
      })
    ]);

    const event = producer.sent.find(
      (m) => m.msgName === ILPPaymentFailedEvent.name
    ) as ILPPaymentFailedEvent;
    assert.ok(event, 'expected ILPPaymentFailedEvent');
    assert.equal(event.payload.reason, 'REJECTED');
    assert.equal(event.payload.rejectCode, 'F06');
    assert.equal(event.payload.rejectMessage, 'unexpected payment');
    assert.equal(event.payload.paymentId, 'pay-1');
    assert.equal(event.requestId, 'req-pay-1');
  });

  test('an R00 reject on a payment yields ILPPaymentFailedEvent with reason EXPIRED', async () => {
    const { producer, consumer } = await startedHandler();
    const sharedSecret = Buffer.alloc(32, 9).toString('base64url');

    await consumer.deliver([
      new StartRemotePaymentCmd(
        {
          peerId: 'peer-1',
          paymentIntentId: 'intent-1',
          paymentId: 'pay-1',
          destinationIlpAddress: 'g.peer.bob',
          amount: '100',
          assetCode: 'USD',
          assetScale: 2,
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
          sharedSecret
        },
        'req-pay-1'
      )
    ]);
    const packetId = dispatchedPacketId(producer);

    await consumer.deliver([
      new ProcessRejectPacketCmd({
        peerId: 'peer-1',
        paymentIntentId: 'intent-1',
        packetId,
        rejectCode: 'R00',
        rejectMessage: 'no fulfill/reject callback received before expiry',
        rejectedAt: new Date().toISOString()
      })
    ]);

    const event = producer.sent.find(
      (m) => m.msgName === ILPPaymentFailedEvent.name
    ) as ILPPaymentFailedEvent;
    assert.ok(event, 'expected ILPPaymentFailedEvent');
    assert.equal(event.payload.reason, 'EXPIRED');
    assert.equal(event.payload.rejectCode, 'R00');
  });
});

describe('IlpCommandHandler — remote quote sending', () => {
  test('a StartRemoteQuoteCmd with no shared secret fails without poisoning the batch', async () => {
    const { producer, consumer } = await startedHandler();

    await consumer.deliver([
      new StartRemoteQuoteCmd(
        {
          peerId: 'peer-1',
          paymentIntentId: 'intent-1',
          quoteId: 'quote-missing',
          destinationIlpAddress: 'g.peer.bob',
          sourceAmount: '100',
          sourceAssetCode: 'USD',
          sourceAssetScale: 2,
          sharedSecret: ''
        },
        'req-quote-missing'
      ),
      startQuote()
    ]);

    const failed = producer.sent.find(
      (m) => m.msgName === ILPQuoteFailedEvent.name
    ) as ILPQuoteFailedEvent;
    assert.ok(failed, 'expected ILPQuoteFailedEvent');
    assert.equal(failed.payload.quoteId, 'quote-missing');
    assert.equal(failed.requestId, 'req-quote-missing');

    const dispatch = producer.sent.find(
      (m) => m.msgName === DispatchPreparePacketCmd.name
    ) as DispatchPreparePacketCmd;
    assert.ok(
      dispatch,
      'sibling command in the same batch must still dispatch'
    );
    assert.equal(dispatch.payload.paymentIntentId, 'intent-1');
  });

  test('a StartRemoteQuoteCmd for an unknown peer fails without poisoning the batch', async () => {
    const { producer, consumer } = await startedHandler();

    await consumer.deliver([
      new StartRemoteQuoteCmd(
        {
          peerId: 'peer-missing',
          paymentIntentId: 'intent-1',
          quoteId: 'quote-missing-peer',
          destinationIlpAddress: 'g.peer.bob',
          sourceAmount: '100',
          sourceAssetCode: 'USD',
          sourceAssetScale: 2,
          sharedSecret: TEST_QUOTE_SECRET
        },
        'req-quote-unknown-peer'
      ),
      startQuote()
    ]);

    const failed = producer.sent.find(
      (m) => m.msgName === ILPQuoteFailedEvent.name
    ) as ILPQuoteFailedEvent;
    assert.ok(failed, 'expected ILPQuoteFailedEvent');
    assert.equal(failed.payload.quoteId, 'quote-missing-peer');
    assert.equal(failed.payload.peerId, 'peer-missing');
    assert.equal(failed.requestId, 'req-quote-unknown-peer');

    const dispatch = producer.sent.find(
      (m) => m.msgName === DispatchPreparePacketCmd.name
    ) as DispatchPreparePacketCmd;
    assert.ok(
      dispatch,
      'sibling command in the same batch must still dispatch'
    );
    assert.equal(dispatch.payload.paymentIntentId, 'intent-1');
  });

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
    assert.ok(dispatch.payload.data, 'expected STREAM quote probe data');
    assert.ok(dispatch.payload.expiresAt);
  });

  test('a peer reject carrying STREAM prepareAmount yields a ILPQuoteReceivedEvent', async () => {
    const { producer, consumer } = await startedHandler();
    await consumer.deliver([startQuote()]);
    const dispatch = producer.sent.find(
      (m) => m.msgName === DispatchPreparePacketCmd.name
    ) as DispatchPreparePacketCmd;
    const packetId = dispatch.payload.packetId;
    const replyData = encodeStreamQuoteReply({
      sharedSecret: Buffer.from(TEST_QUOTE_SECRET, 'base64url'),
      prepareData: Buffer.from(dispatch.payload.data as string, 'base64'),
      prepareAmount: '95'
    });
    assert.ok(replyData);

    await consumer.deliver([
      new ProcessRejectPacketCmd({
        peerId: 'peer-1',
        paymentIntentId: 'intent-1',
        packetId,
        rejectCode: 'F99',
        rejectMessage: 'quote response',
        rejectedAt: new Date().toISOString(),
        data: replyData!.toString('base64')
      })
    ]);

    const event = producer.sent.find(
      (m) => m.msgName === ILPQuoteReceivedEvent.name
    ) as ILPQuoteReceivedEvent;
    assert.ok(event, 'expected a ILPQuoteReceivedEvent');
    assert.equal(event.msgTopic, 'ilp-domain-events');
    assert.equal(event.payload.quoteId, 'quote-1');
    assert.equal(event.payload.destinationAmount, '95');
    assert.equal(event.requestId, 'req-1');
  });

  test('a resolved quote leaves no shared secret behind in the store', async () => {
    const { producer, consumer, repo } = await startedHandler();
    await consumer.deliver([startQuote()]);
    const dispatch = producer.sent.find(
      (m) => m.msgName === DispatchPreparePacketCmd.name
    ) as DispatchPreparePacketCmd;
    const packetId = dispatch.payload.packetId;

    const pending = await repo.fetchPacketById(packetId);
    assert.ok(pending && pending.kind === 'QUOTE');
    assert.equal(pending.sharedSecret, TEST_QUOTE_SECRET);

    const replyData = encodeStreamQuoteReply({
      sharedSecret: Buffer.from(TEST_QUOTE_SECRET, 'base64url'),
      prepareData: Buffer.from(dispatch.payload.data as string, 'base64'),
      prepareAmount: '95'
    });
    assert.ok(replyData);

    await consumer.deliver([
      new ProcessRejectPacketCmd({
        peerId: 'peer-1',
        paymentIntentId: 'intent-1',
        packetId,
        rejectCode: 'F99',
        rejectMessage: 'quote response',
        rejectedAt: new Date().toISOString(),
        data: replyData!.toString('base64')
      })
    ]);

    // The reply still decoded, so the secret was read before being dropped.
    const received = producer.sent.find(
      (m) => m.msgName === ILPQuoteReceivedEvent.name
    ) as ILPQuoteReceivedEvent;
    assert.equal(received.payload.destinationAmount, '95');

    const terminal = await repo.fetchPacketById(packetId);
    assert.ok(terminal && terminal.kind === 'QUOTE');
    assert.equal(terminal.state, 'REJECTED');
    assert.equal(
      terminal.sharedSecret,
      undefined,
      'a terminal correlation must not keep a live STREAM key at rest'
    );
  });

  test('a transient reject is not a rate, however well it decrypts', async () => {
    const { producer, consumer } = await startedHandler();
    await consumer.deliver([startQuote()]);
    const dispatch = producer.sent.find(
      (m) => m.msgName === DispatchPreparePacketCmd.name
    ) as DispatchPreparePacketCmd;
    const replyData = encodeStreamQuoteReply({
      sharedSecret: Buffer.from(TEST_QUOTE_SECRET, 'base64url'),
      prepareData: Buffer.from(dispatch.payload.data as string, 'base64'),
      prepareAmount: '95'
    });
    assert.ok(replyData);

    await consumer.deliver([
      new ProcessRejectPacketCmd({
        peerId: 'peer-1',
        paymentIntentId: 'intent-1',
        packetId: dispatch.payload.packetId,
        rejectCode: 'T04',
        rejectMessage: 'insufficient liquidity',
        rejectedAt: new Date().toISOString(),
        data: replyData!.toString('base64')
      })
    ]);

    assert.equal(
      producer.sent.filter((m) => m.msgName === ILPQuoteReceivedEvent.name)
        .length,
      0,
      'a T-class reject means "ask again", not "here is the rate"'
    );
    assert.ok(
      producer.sent.find((m) => m.msgName === ILPQuoteFailedEvent.name)
    );
  });

  test('a receiver that closes the connection has not quoted us', async () => {
    const { producer, consumer } = await startedHandler();
    await consumer.deliver([startQuote()]);
    const packetId = dispatchedPacketId(producer);

    const closed = new Packet(1, IlpPacketType.Reject, '95', [
      new ConnectionCloseFrame(ErrorCode.ApplicationError, 'no thanks')
    ]);
    const replyData = encryptStreamData(
      hmacSha256(
        Buffer.from(TEST_QUOTE_SECRET, 'base64url'),
        ENCRYPTION_KEY_STRING
      ),
      closed._serialize()
    );

    await consumer.deliver([
      new ProcessRejectPacketCmd({
        peerId: 'peer-1',
        paymentIntentId: 'intent-1',
        packetId,
        rejectCode: 'F99',
        rejectMessage: 'application error',
        rejectedAt: new Date().toISOString(),
        data: replyData.toString('base64')
      })
    ]);

    // F99 plus a readable amount, but the ConnectionClose makes it a refusal.
    assert.equal(
      producer.sent.filter((m) => m.msgName === ILPQuoteReceivedEvent.name)
        .length,
      0
    );
    assert.ok(
      producer.sent.find((m) => m.msgName === ILPQuoteFailedEvent.name)
    );
  });

  test('a peer reject without amounts yields a ILPQuoteFailedEvent', async () => {
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
      (m) => m.msgName === ILPQuoteFailedEvent.name
    ) as ILPQuoteFailedEvent;
    assert.ok(event, 'expected a ILPQuoteFailedEvent');
    assert.equal(event.payload.rejectCode, 'F02');
    assert.equal(event.isErrorEvent, true);
    assert.equal(event.requestId, 'req-1');
  });

  test('an R00 reject on a quote marks ILPQuoteFailedEvent as expired', async () => {
    const { producer, consumer } = await startedHandler();
    await consumer.deliver([startQuote()]);
    const packetId = dispatchedPacketId(producer);

    await consumer.deliver([
      new ProcessRejectPacketCmd({
        peerId: 'peer-1',
        paymentIntentId: 'intent-1',
        packetId,
        rejectCode: 'R00',
        rejectMessage: 'timed out',
        rejectedAt: new Date().toISOString()
      })
    ]);

    const event = producer.sent.find(
      (m) => m.msgName === ILPQuoteFailedEvent.name
    ) as ILPQuoteFailedEvent;
    assert.ok(event, 'expected a ILPQuoteFailedEvent');
    assert.equal(event.payload.rejectCode, 'R00');
    assert.equal(event.payload.expired, true);
  });

  test('an expiry with no response yields a ILPQuoteFailedEvent (timeout)', async () => {
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
      (m) => m.msgName === ILPQuoteFailedEvent.name
    ) as ILPQuoteFailedEvent;
    assert.ok(event, 'expected a ILPQuoteFailedEvent');
    assert.equal(event.payload.expired, true);
    assert.equal(event.requestId, 'req-1');
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
      expiresAt: new Date().toISOString(),
      data: Buffer.from('stream-quote-probe').toString('base64')
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
    assert.equal(
      cmd.payload.data,
      Buffer.from('stream-quote-probe').toString('base64')
    );
  });

  test('maps a PAYMENT dispatch using the provided STREAM condition and data', async () => {
    const producer = new MockProducer();
    const client = new KafkaPeeringClient(producer, new ConsoleLogger());
    const executionCondition = Buffer.alloc(32, 1).toString('base64');
    const data = Buffer.from('stream-ciphertext').toString('base64');

    await client.dispatch({
      type: 'PAYMENT',
      peerId: 'peer-9',
      packetId: 'pk-pay',
      paymentIntentId: 'intent-9',
      paymentId: 'pay-9',
      destinationIlpAddress: 'g.peer.bob',
      amount: '100',
      assetCode: 'USD',
      assetScale: 2,
      expiresAt: new Date().toISOString(),
      sharedSecret: Buffer.alloc(32, 2).toString('base64url'),
      executionCondition,
      data
    });

    assert.equal(producer.sent.length, 1);
    const cmd = producer.sent[0] as DispatchPreparePacketCmd;
    assert.equal(cmd.payload.executionCondition, executionCondition);
    assert.equal(cmd.payload.data, data);
    assert.equal(cmd.payload.amount, '100');
  });
});
