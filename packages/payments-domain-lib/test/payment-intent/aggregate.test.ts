import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { isRemoteSentPayment } from '../../src/payment-intent/interfaces';
import { NullLogger } from 'common-types-lib';

import { PaymentIntentAggregate } from '../../src/payment-intent/aggregate';
import {
  PaymentCompletedEvent,
  PaymentCompleteFailedEvent,
  PaymentCreatedEvent,
  PaymentCreateFailedEvent,
  PaymentIntentCreatedEvent,
  PaymentIntentCreateFailedEvent,
  PaymentIntentCompletedEvent,
  PaymentIntentCompleteFailedEvent
} from 'payments-public-types-lib';
import {
  CompleteRemoteQuoteCmd,
  CompletePaymentIntentCmd,
  CreatePaymentCmd,
  CreatePaymentIntentCmd,
  FailRemoteQuoteCmd,
  CalculateRemoteQuoteCmd,
  CancelPaymentCmd,
  PrepareRemotePaymentCmd,
  FailRemotePaymentCmd,
  ConfirmRemotePaymentCmd,
  RejectRemotePaymentCmd,
  CompleteRemotePaymentCmd,
  ValidateInboundPaymentCmd,
  AcceptInboundPaymentCmd,
  FailInboundPaymentCmd,
  MarkInboundPaymentFulfillableCmd,
  FinalizeInboundPaymentCmd
} from '../../src/commands';
import {
  MockPaymentIntentRepo,
  MockRemotePaymentIntentService,
  MockPalService,
  toIncomingPaymentWithMethods
} from '../mocks';
import {
  QuoteCreateFailedEvent,
  QuoteCompletedEvent
} from 'payments-public-types-lib';
import { CreateQuoteCmd } from '../../src/commands';
import {
  IPaymentIntent,
  SentPaymentState
} from '../../src/payment-intent/interfaces';
import { ApprovePaymentCmd } from '../../src/commands';
import {
  RemoteQuoteRequestedEvent,
  RemoteQuoteCalculatedEvent,
  RemoteQuoteCalculationFailedEvent,
  PaymentCancelledEvent,
  PaymentCancelFailedEvent,
  RemotePaymentSendApprovedEvent,
  RemotePaymentPreparedEvent,
  PaymentFailedEvent,
  RemotePaymentSendConfirmedEvent,
  RemotePaymentSendRejectedEvent,
  InboundPaymentValidatedEvent,
  InboundPaymentValidationFailedEvent,
  InboundPaymentAcceptedEvent,
  InboundPaymentFailedEvent,
  InboundPaymentFulfillableEvent,
  InboundPaymentFinalizedEvent
} from 'payments-public-types-lib';

function makeApprovePaymentCmd(
  overrides: Partial<{
    id: string;
    paymentIntentId: string;
  }> = {}
): ApprovePaymentCmd {
  return new ApprovePaymentCmd(
    {
      id: overrides.id ?? crypto.randomUUID(),
      paymentIntentId: overrides.paymentIntentId ?? crypto.randomUUID(),
      ...overrides
    },
    crypto.randomUUID()
  );
}

function makeCancelPaymentCmd(
  overrides: Partial<{
    id: string;
    paymentIntentId: string;
    reason: string;
  }> = {}
): CancelPaymentCmd {
  return new CancelPaymentCmd(
    {
      id: overrides.id ?? crypto.randomUUID(),
      paymentIntentId: overrides.paymentIntentId ?? crypto.randomUUID(),
      reason: overrides.reason ?? 'cancelled by user',
      ...overrides
    },
    crypto.randomUUID()
  );
}

function makeCreatePaymentIntentCmd(
  overrides: Partial<{
    id: string;
    receiverWalletAddressId: string;
    receiverWalletAddress: string;
    expiresAt: string;
    incomingAmount: number;
  }> = {}
): CreatePaymentIntentCmd {
  return new CreatePaymentIntentCmd(
    {
      id: overrides.id ?? crypto.randomUUID(),
      receiverWalletAddressId: overrides.receiverWalletAddressId ?? 'wallet-1',
      receiverWalletAddress:
        overrides.receiverWalletAddress ?? 'domain.com/alice',
      expiresAt: overrides.expiresAt,
      incomingAmount: overrides.incomingAmount
    },
    crypto.randomUUID()
  );
}

function makeCompletePaymentIntentCmd(
  overrides: Partial<{ id: string }> = {}
): CompletePaymentIntentCmd {
  return new CompletePaymentIntentCmd(
    {
      id: overrides.id ?? crypto.randomUUID()
    },
    crypto.randomUUID()
  );
}

function makeCreateQuoteCmd(
  overrides: Partial<{
    id: string;
    paymentIntentId: string;
    senderWalletAddressId: string;
    senderWalletAddress: string;
    debitAmount: number;
    receiveAmount: number;
    remotePaymentIntentUrl: string;
  }> = {}
): CreateQuoteCmd {
  return new CreateQuoteCmd(
    {
      id: crypto.randomUUID(),
      paymentIntentId: crypto.randomUUID(),
      senderWalletAddressId: 'wallet-1',
      senderWalletAddress: 'domain.com/bob',
      debitAmount: 100,
      ...overrides
    },
    crypto.randomUUID()
  );
}

function makeCreatePaymentCmd(
  overrides: Partial<{
    id: string;
    paymentIntentId: string;
    senderWalletAddressId: string;
    senderWalletAddress: string;
    debitAmount: number | undefined;
    quoteId: string;
    remotePaymentIntentUrl: string;
    grantId: string;
  }> = {}
): CreatePaymentCmd {
  return new CreatePaymentCmd(
    {
      id: crypto.randomUUID(),
      paymentIntentId: crypto.randomUUID(),
      senderWalletAddressId: 'wallet-1',
      senderWalletAddress: 'domain.com/bob',
      debitAmount: 100,
      ...overrides
    },
    crypto.randomUUID()
  );
}

describe('PaymentIntentAggregate.handleBatch', () => {
  let repo: MockPaymentIntentRepo;
  let mockRemotePaymentIntentService: MockRemotePaymentIntentService;
  let mockPalService: MockPalService;
  let aggregate: PaymentIntentAggregate;

  beforeEach(() => {
    repo = new MockPaymentIntentRepo();
    mockPalService = new MockPalService();
    mockPalService.addWalletAddress({
      id: 'wallet-1',
      isActive: true,
      assetCode: 'USD',
      assetScale: 2
    });
    mockRemotePaymentIntentService = new MockRemotePaymentIntentService();
    aggregate = new PaymentIntentAggregate(
      repo,
      mockPalService,
      mockRemotePaymentIntentService,
      new NullLogger()
    );
  });

  function makeRemotePaymentIntentWithPendingQuote(
    quoteId: string
  ): IPaymentIntent {
    return {
      id: crypto.randomUUID(),
      createdAt: new Date(),
      receivedAmount: 0n,
      receiverWalletAddress: 'remote.domain.com/alice',
      assetCode: 'USD',
      assetScale: 2,
      state: 'CREATED',
      destination: 'REMOTE',
      expiresAt: new Date(Date.now() + 60_000),
      incomingAmount: null,
      quotes: [
        {
          id: quoteId,
          state: 'PENDING',
          senderWalletAddress: 'domain.com/bob',
          senderWalletAddressId: 'wallet-1',
          createdAt: new Date(),
          route: {
            peerId: 'peer-1',
            peerAssetCode: 'USD',
            peerAssetScale: 2,
            sourceAmount: 100n,
            senderAssetCode: 'USD'
          },
          debitAmount: 500n
        }
      ],
      sentPayments: [],
      inboundPayments: [],
      destinationIlpAddress: 'g.peer.123'
    };
  }

  describe('handleBatch', async () => {
    describe('handleCreatePaymentIntentCommand', async () => {
      it('creates a payment intent', async () => {
        const cmd = makeCreatePaymentIntentCmd();
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentIntentCreatedEvent.name);
        const payload = (events[0] as PaymentIntentCreatedEvent).payload;
        assert.equal(payload.id, cmd.payload.id);
        assert.equal(
          payload.receiverWalletAddress,
          cmd.payload.receiverWalletAddress
        );
        assert.equal(
          payload.receiverWalletAddressId,
          cmd.payload.receiverWalletAddressId
        );
        assert.equal(payload.state, 'CREATED');
        assert.equal(payload.destination, 'LOCAL');
        assert.equal(payload.incomingAmount, null);
        assert.equal(payload.receivedAmount, '0');
        assert.equal(payload.assetCode, 'USD');
        assert.equal(payload.assetScale, 2);
        assert.ok(payload.createdAt instanceof Date);
        assert.ok(payload.expiresAt instanceof Date);
      });

      it('fails if duplicate payment intent id', async () => {
        const id = crypto.randomUUID();
        const cmd1 = makeCreatePaymentIntentCmd({ id });
        const cmd2 = makeCreatePaymentIntentCmd({ id });
        const { events } = await aggregate.handleBatch([cmd1, cmd2]);

        assert.equal(events.length, 2);
        assert.equal(events[0].msgName, PaymentIntentCreatedEvent.name);
        assert.equal(events[1].msgName, PaymentIntentCreateFailedEvent.name);
        const payload = (events[1] as PaymentIntentCreateFailedEvent).payload;
        assert.equal(
          payload.errorName,
          'CannotCreateDuplicatePaymentIntentError'
        );
      });

      it('fails if when wallet address not found', async () => {
        const cmd = makeCreatePaymentIntentCmd({
          receiverWalletAddressId: 'nonexistent'
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentIntentCreateFailedEvent.name);
        const payload = (events[0] as PaymentIntentCreateFailedEvent).payload;
        assert.equal(payload.errorName, 'WalletAddressNotFoundError');
      });

      it('fails if when wallet address is inactive', async () => {
        mockPalService.addWalletAddress({
          id: 'inactive-wallet',
          isActive: false,
          assetCode: 'USD',
          assetScale: 2
        });
        const cmd = makeCreatePaymentIntentCmd({
          receiverWalletAddressId: 'inactive-wallet'
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentIntentCreateFailedEvent.name);
        const payload = (events[0] as PaymentIntentCreateFailedEvent).payload;
        assert.equal(payload.errorName, 'WalletAddressInactiveError');
      });
    });

    describe('handleCompletePaymentIntentCommand', () => {
      function makeLocalIntent(
        overrides: Partial<{
          state: IPaymentIntent['state'];
          destination: IPaymentIntent['destination'];
          expiresAt: Date;
        }> = {}
      ): IPaymentIntent {
        return {
          id: crypto.randomUUID(),
          receivedAmount: 0n,
          receiverWalletAddress: 'domain.com/alice',
          receiverWalletAddressId: 'wallet-1',
          assetCode: 'USD',
          assetScale: 2,
          state: overrides.state ?? 'CREATED',
          destination: overrides.destination ?? 'LOCAL',
          createdAt: new Date(),
          expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000),
          incomingAmount: null,
          quotes: [],
          sentPayments: [],
          inboundPayments: []
        };
      }

      it('completes a local payment intent', async () => {
        const intent = makeLocalIntent();
        await repo.storeMany([intent]);

        const cmd = makeCompletePaymentIntentCmd({ id: intent.id });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentIntentCompletedEvent.name);
        const payload = (events[0] as PaymentIntentCompletedEvent).payload;
        assert.equal(payload.id, intent.id);
        assert.equal(payload.state, 'COMPLETED');
        assert.equal(payload.assetCode, 'USD');
        assert.equal(payload.assetScale, 2);

        await aggregate.flush();
        const stored = repo.getAll().find((p) => p.id === intent.id);
        assert(stored);
        assert.equal(stored.state, 'COMPLETED');
      });

      it('fails when payment intent not found', async () => {
        const cmd = makeCompletePaymentIntentCmd({ id: 'nonexistent' });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentIntentCompleteFailedEvent.name);
        const payload = (events[0] as PaymentIntentCompleteFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentIntentNotFoundError');
        assert.equal(payload.id, 'nonexistent');
      });

      it('fails when payment intent destination is REMOTE', async () => {
        const intent = makeLocalIntent({ destination: 'REMOTE' });
        await repo.storeMany([intent]);

        const cmd = makeCompletePaymentIntentCmd({ id: intent.id });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentIntentCompleteFailedEvent.name);
        const payload = (events[0] as PaymentIntentCompleteFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentIntentInvalidState');
        assert.match(payload.message, /destination must be local/);
      });

      it('fails when payment intent is already COMPLETED', async () => {
        const intent = makeLocalIntent({ state: 'COMPLETED' });
        await repo.storeMany([intent]);

        const cmd = makeCompletePaymentIntentCmd({ id: intent.id });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentIntentCompleteFailedEvent.name);
        const payload = (events[0] as PaymentIntentCompleteFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentIntentInvalidState');
      });

      it('fails when payment intent is expired', async () => {
        const intent = makeLocalIntent({
          expiresAt: new Date(Date.now() - 1000)
        });
        await repo.storeMany([intent]);

        const cmd = makeCompletePaymentIntentCmd({ id: intent.id });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentIntentCompleteFailedEvent.name);
        const payload = (events[0] as PaymentIntentCompleteFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentIntentExpired');
      });
    });

    describe('handleCreateQuoteCommand', () => {
      it('fails when sender wallet address not found', async () => {
        const quoteCmd = makeCreateQuoteCmd({
          senderWalletAddressId: 'nonexistent'
        });
        const { events } = await aggregate.handleBatch([quoteCmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, QuoteCreateFailedEvent.name);
        const payload = (events[0] as QuoteCreateFailedEvent).payload;
        assert.equal(payload.errorName, 'WalletAddressNotFoundError');
        assert.match(payload.message, /Wallet address nonexistent not found/);
      });

      it('fails when sender wallet address is inactive', async () => {
        mockPalService.addWalletAddress({
          id: 'inactive-sender',
          isActive: false,
          assetCode: 'USD',
          assetScale: 2
        });

        const quoteCmd = makeCreateQuoteCmd({
          senderWalletAddressId: 'inactive-sender'
        });
        const { events } = await aggregate.handleBatch([quoteCmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, QuoteCreateFailedEvent.name);
        const payload = (events[0] as QuoteCreateFailedEvent).payload;
        assert.equal(payload.errorName, 'WalletAddressInactiveError');
      });

      it('fails when payment intent not found', async () => {
        const quoteCmd = makeCreateQuoteCmd({
          paymentIntentId: 'nonexistent'
        });
        const { events } = await aggregate.handleBatch([quoteCmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, QuoteCreateFailedEvent.name);
        const payload = (events[0] as QuoteCreateFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentIntentNotFoundError');
      });

      it('fails if rates could not be fetched', async () => {
        const paymentIntent: IPaymentIntent = {
          id: crypto.randomUUID(),
          receivedAmount: 0n,
          receiverWalletAddress: 'receiver',
          receiverWalletAddressId: crypto.randomUUID(),
          assetCode: 'EUR',
          assetScale: 2,
          state: 'CREATED',
          destination: 'LOCAL',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 1000),
          incomingAmount: null,
          quotes: [],
          sentPayments: [],
          inboundPayments: []
        };
        await repo.storeMany([paymentIntent]);

        mockPalService.getRates = async () => null;

        const cmd = makeCreateQuoteCmd({
          paymentIntentId: paymentIntent.id
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, QuoteCreateFailedEvent.name);
        const payload = (events[0] as QuoteCreateFailedEvent).payload;
        assert.equal(payload.errorName, 'RatesError');
      });

      it('creates local quote', async () => {
        const paymentIntent: IPaymentIntent = {
          id: crypto.randomUUID(),
          receivedAmount: 0n,
          receiverWalletAddress: 'receiver',
          receiverWalletAddressId: crypto.randomUUID(),
          assetCode: 'USD',
          assetScale: 2,
          state: 'CREATED',
          destination: 'LOCAL',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 1000),
          incomingAmount: null,
          quotes: [],
          sentPayments: [],
          inboundPayments: []
        };
        await repo.storeMany([paymentIntent]);

        const cmd = makeCreateQuoteCmd({
          paymentIntentId: paymentIntent.id
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, QuoteCompletedEvent.name);
        const completedPayload = (events[0] as QuoteCompletedEvent).payload;
        assert.equal(completedPayload.id, cmd.payload.id);
        assert.equal(completedPayload.paymentIntentId, paymentIntent.id);
        assert.ok(completedPayload.createdAt);
        assert.ok(!Number.isNaN(Date.parse(completedPayload.createdAt)));
      });

      it('emits RemoteQuoteRequestedEvent for remote payment intent', async () => {
        const paymentIntent: IPaymentIntent = {
          id: crypto.randomUUID(),
          receivedAmount: 0n,
          receiverWalletAddress: 'remote.domain.com/alice',
          assetCode: 'USD',
          assetScale: 2,
          state: 'CREATED',
          destination: 'REMOTE',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          incomingAmount: null,
          quotes: [],
          sentPayments: [],
          inboundPayments: [],
          destinationIlpAddress: 'g.peer.123'
        };
        await repo.storeMany([paymentIntent]);

        const cmd = makeCreateQuoteCmd({
          paymentIntentId: paymentIntent.id,
          debitAmount: 500
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, RemoteQuoteRequestedEvent.name);
        const payload = (events[0] as RemoteQuoteRequestedEvent).payload;
        assert.equal(payload.paymentIntentId, paymentIntent.id);
        assert.equal(payload.quoteId, cmd.payload.id);
        assert.equal(payload.peerId, 'peer-1');
        assert.equal(
          payload.receiverWalletAddress,
          paymentIntent.receiverWalletAddress
        );
        assert.equal(
          payload.senderWalletAddress,
          cmd.payload.senderWalletAddress
        );
        assert.equal(payload.senderAssetCode, 'USD');
        assert.equal(payload.senderAssetScale, 2);
      });

      it('fails with MissingDestinationIlpAddressError for remote intent without ilp address', async () => {
        const paymentIntent: IPaymentIntent = {
          id: crypto.randomUUID(),
          receivedAmount: 0n,
          receiverWalletAddress: 'remote.domain.com/alice',
          assetCode: 'USD',
          assetScale: 2,
          state: 'CREATED',
          destination: 'REMOTE',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          incomingAmount: null,
          quotes: [],
          sentPayments: [],
          inboundPayments: []
        };
        await repo.storeMany([paymentIntent]);

        const cmd = makeCreateQuoteCmd({ paymentIntentId: paymentIntent.id });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, QuoteCreateFailedEvent.name);
        const payload = (events[0] as QuoteCreateFailedEvent).payload;
        assert.equal(payload.errorName, 'MissingDestinationIlpAddressError');
      });
    });

    describe('handleCompleteRemoteQuoteCommand', () => {
      function makeCompleteRemoteQuoteCmd(
        overrides: Partial<{
          paymentIntentId: string;
          quoteId: string;
          receiveAmountValue: string;
        }> = {}
      ): CompleteRemoteQuoteCmd {
        return new CompleteRemoteQuoteCmd(
          {
            paymentIntentId: overrides.paymentIntentId ?? crypto.randomUUID(),
            quoteId: overrides.quoteId ?? crypto.randomUUID(),
            receiveAmountValue: overrides.receiveAmountValue ?? '10000'
          },
          crypto.randomUUID()
        );
      }

      it('emits QuoteCompletedEvent on success', async () => {
        const quoteId = crypto.randomUUID();
        const paymentIntent = makeRemotePaymentIntentWithPendingQuote(quoteId);
        await repo.storeMany([paymentIntent]);

        const cmd = makeCompleteRemoteQuoteCmd({
          paymentIntentId: paymentIntent.id,
          quoteId
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, QuoteCompletedEvent.name);
        const payload = (events[0] as QuoteCompletedEvent).payload;
        assert.equal(payload.id, quoteId);
        assert.equal(payload.paymentIntentId, paymentIntent.id);
        assert.ok(payload.createdAt);
        assert.ok(!Number.isNaN(Date.parse(payload.createdAt)));
      });

      it('fails when payment intent not found', async () => {
        const cmd = makeCompleteRemoteQuoteCmd({
          paymentIntentId: 'nonexistent'
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, QuoteCreateFailedEvent.name);
        const payload = (events[0] as QuoteCreateFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentIntentNotFoundError');
      });

      it('fails when quote not found', async () => {
        const paymentIntent = makeRemotePaymentIntentWithPendingQuote(
          crypto.randomUUID()
        );
        await repo.storeMany([paymentIntent]);

        const cmd = makeCompleteRemoteQuoteCmd({
          paymentIntentId: paymentIntent.id,
          quoteId: 'nonexistent-quote'
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, QuoteCreateFailedEvent.name);
        const payload = (events[0] as QuoteCreateFailedEvent).payload;
        assert.equal(payload.errorName, 'InvalidQuoteIdError');
      });

      describe('FX calculation', () => {
        function makeCrossAssetPendingQuoteIntent(
          quoteId: string,
          amountOverride: { debitAmount: bigint } | { receiveAmount: bigint }
        ): IPaymentIntent {
          return {
            id: crypto.randomUUID(),
            receivedAmount: 0n,
            receiverWalletAddress: 'remote.domain.com/alice',
            assetCode: 'XRP',
            assetScale: 6,
            state: 'CREATED',
            destination: 'REMOTE',
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
            incomingAmount: null,
            quotes: [
              {
                id: quoteId,
                state: 'PENDING',
                senderWalletAddress: 'domain.com/bob',
                senderWalletAddressId: 'wallet-1',
                createdAt: new Date(),
                route: {
                  peerId: 'peer-1',
                  peerAssetCode: 'EUR',
                  peerAssetScale: 2,
                  sourceAmount: 100n,
                  senderAssetCode: 'USD'
                },
                ...amountOverride
              }
            ],
            sentPayments: [],
            inboundPayments: [],
            destinationIlpAddress: 'g.peer.123'
          };
        }

        it('cross-asset success: prefetched FX rate is passed to entity and applied', async () => {
          const quoteId = crypto.randomUUID();
          const paymentIntent = makeCrossAssetPendingQuoteIntent(quoteId, {
            debitAmount: 1000n
          });
          mockPalService.getRates = async () => 0.9;
          await repo.storeMany([paymentIntent]);

          const cmd = makeCompleteRemoteQuoteCmd({
            paymentIntentId: paymentIntent.id,
            quoteId,
            receiveAmountValue: '10000'
          });
          const { events } = await aggregate.handleBatch([cmd]);

          assert.equal(events[0].msgName, QuoteCompletedEvent.name);
          const payload = (events[0] as QuoteCompletedEvent).payload;
          // debitAmount = 1000 USD
          // receiveAmount = USD amount * (USD->EUR rate) * (EUR->receiver rate)
          //              = 1000 * (0.9) * (10000 / 100)
          //              = 90000 XRP
          assert.equal(payload.debitAmount, '1000');
          assert.equal(payload.receiveAmount, '90000');
          assert.equal(payload.exchangeRate, 90);
          assert.ok(payload.createdAt);
          assert.ok(!Number.isNaN(Date.parse(payload.createdAt)));
        });

        it('fails with RatesError when FX rate is unavailable', async () => {
          const quoteId = crypto.randomUUID();
          const paymentIntent = makeCrossAssetPendingQuoteIntent(quoteId, {
            debitAmount: 1000n
          });
          mockPalService.getRates = async () => null;
          await repo.storeMany([paymentIntent]);

          const cmd = makeCompleteRemoteQuoteCmd({
            paymentIntentId: paymentIntent.id,
            quoteId,
            receiveAmountValue: '10000'
          });
          const { events } = await aggregate.handleBatch([cmd]);

          assert.equal(events[0].msgName, QuoteCreateFailedEvent.name);
          const payload = (events[0] as QuoteCreateFailedEvent).payload;
          assert.equal(payload.errorName, 'RatesError');
        });
      });
    });

    describe('handleFailRemoteQuoteCommand', () => {
      function makeFailRemoteQuoteCmd(
        overrides: Partial<{
          paymentIntentId: string;
          quoteId: string;
          errorName: string;
          message: string;
        }> = {}
      ): FailRemoteQuoteCmd {
        return new FailRemoteQuoteCmd(
          {
            paymentIntentId: overrides.paymentIntentId ?? crypto.randomUUID(),
            quoteId: overrides.quoteId ?? crypto.randomUUID(),
            errorName: overrides.errorName ?? 'IlpQuoteError',
            message: overrides.message ?? 'Quote could not be determined'
          },
          crypto.randomUUID()
        );
      }

      it('emits QuoteCreateFailedEvent with ILP error details', async () => {
        const quoteId = crypto.randomUUID();
        const paymentIntent = makeRemotePaymentIntentWithPendingQuote(quoteId);
        await repo.storeMany([paymentIntent]);

        const cmd = makeFailRemoteQuoteCmd({
          paymentIntentId: paymentIntent.id,
          quoteId,
          errorName: 'IlpQuoteError',
          message: 'No route to destination'
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, QuoteCreateFailedEvent.name);
        const payload = (events[0] as QuoteCreateFailedEvent).payload;
        assert.equal(payload.paymentIntentId, paymentIntent.id);
        assert.equal(payload.errorName, 'IlpQuoteError');
        assert.equal(payload.message, 'No route to destination');
      });

      it('fails when payment intent not found', async () => {
        const cmd = makeFailRemoteQuoteCmd({ paymentIntentId: 'nonexistent' });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, QuoteCreateFailedEvent.name);
        const payload = (events[0] as QuoteCreateFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentIntentNotFoundError');
      });

      it('fails when quote not found', async () => {
        const paymentIntent = makeRemotePaymentIntentWithPendingQuote(
          crypto.randomUUID()
        );
        await repo.storeMany([paymentIntent]);

        const cmd = makeFailRemoteQuoteCmd({
          paymentIntentId: paymentIntent.id,
          quoteId: 'nonexistent-quote'
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, QuoteCreateFailedEvent.name);
        const payload = (events[0] as QuoteCreateFailedEvent).payload;
        assert.equal(payload.errorName, 'InvalidQuoteIdError');
      });
    });

    describe('handleCalculateRemoteQuoteCommand', () => {
      function makeLocalIntent(
        overrides: Partial<{
          assetCode: string;
          assetScale: number;
        }> = {}
      ): IPaymentIntent {
        return {
          id: crypto.randomUUID(),
          receivedAmount: 0n,
          receiverWalletAddress: 'domain.com/alice',
          receiverWalletAddressId: 'wallet-1',
          assetCode: overrides.assetCode ?? 'USD',
          assetScale: overrides.assetScale ?? 2,
          state: 'CREATED',
          destination: 'LOCAL',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          incomingAmount: null,
          quotes: [],
          sentPayments: [],
          inboundPayments: []
        };
      }

      function makeCalculateRemoteQuoteCmd(
        overrides: Partial<{
          packetId: string;
          peerId: string;
          paymentIntentId: string;
          sourceAmount: string;
          peerAssetCode: string;
          peerAssetScale: number;
        }> = {}
      ): CalculateRemoteQuoteCmd {
        const peerId = overrides.peerId ?? 'peer-1';
        // Peer asset is resolved from PAL (getPeerById), not carried on the
        // command — route the override to the mock PAL service.
        mockPalService.setPeerById({
          peerId,
          assetCode: overrides.peerAssetCode ?? 'USD',
          assetScale: overrides.peerAssetScale ?? 2
        });
        return new CalculateRemoteQuoteCmd(
          {
            packetId: overrides.packetId ?? crypto.randomUUID(),
            peerId,
            paymentIntentId: overrides.paymentIntentId ?? crypto.randomUUID(),
            sourceAmount: overrides.sourceAmount ?? '100'
          },
          crypto.randomUUID()
        );
      }

      it('same-asset: emits RemoteQuoteCalculatedEvent with receiveAmount = sourceAmount', async () => {
        const intent = makeLocalIntent({ assetCode: 'USD', assetScale: 2 });
        await repo.storeMany([intent]);

        const cmd = makeCalculateRemoteQuoteCmd({
          paymentIntentId: intent.id,
          peerAssetCode: 'USD',
          peerAssetScale: 2,
          sourceAmount: '100'
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, RemoteQuoteCalculatedEvent.name);
        const payload = (events[0] as RemoteQuoteCalculatedEvent).payload;
        assert.equal(payload.paymentIntentId, intent.id);
        assert.equal(payload.receiveAmount, '100');
        assert.equal(payload.receiveAssetCode, 'USD');
        assert.equal(payload.receiveAssetScale, 2);
        assert.equal(payload.packetId, cmd.payload.packetId);
        assert.equal(payload.peerId, cmd.payload.peerId);
      });

      it('cross-asset same scale: floors receiveAmount = sourceAmount * fxRate', async () => {
        const intent = makeLocalIntent({ assetCode: 'XRP', assetScale: 2 });
        await repo.storeMany([intent]);
        mockPalService.getRates = async () => 100.5;

        const cmd = makeCalculateRemoteQuoteCmd({
          paymentIntentId: intent.id,
          peerAssetCode: 'USD',
          peerAssetScale: 2,
          sourceAmount: '100'
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, RemoteQuoteCalculatedEvent.name);
        const payload = (events[0] as RemoteQuoteCalculatedEvent).payload;
        // scaleDiff = 0, floor(100 * 100.5) = 10050
        assert.equal(payload.receiveAmount, '10050');
        assert.equal(payload.receiveAssetCode, 'XRP');
        assert.equal(payload.receiveAssetScale, 2);
      });

      it('cross-asset receiver scale > peer scale: emits in receiver scale', async () => {
        // peer EUR/2, receiver XRP/4, 1 EUR = 2 XRP
        // sourceAmount = 100 (1.00 EUR) -> 2.00 XRP = 20000 units
        const intent = makeLocalIntent({ assetCode: 'XRP', assetScale: 4 });
        await repo.storeMany([intent]);
        mockPalService.getRates = async () => 2;

        const cmd = makeCalculateRemoteQuoteCmd({
          paymentIntentId: intent.id,
          peerAssetCode: 'EUR',
          peerAssetScale: 2,
          sourceAmount: '100'
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, RemoteQuoteCalculatedEvent.name);
        const payload = (events[0] as RemoteQuoteCalculatedEvent).payload;
        // scaleDiff = 4 - 2 = 2, floor(100 * 2 * 100) = 20000
        assert.equal(payload.receiveAmount, '20000');
        assert.equal(payload.receiveAssetCode, 'XRP');
        assert.equal(payload.receiveAssetScale, 4);
      });

      it('fails with PaymentIntentNotFoundError when intent missing', async () => {
        const cmd = makeCalculateRemoteQuoteCmd({
          paymentIntentId: 'nonexistent'
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, RemoteQuoteCalculationFailedEvent.name);
        const payload = (events[0] as RemoteQuoteCalculationFailedEvent)
          .payload;
        assert.equal(payload.errorName, 'PaymentIntentNotFoundError');
        assert.equal(payload.paymentIntentId, 'nonexistent');
        assert.equal(payload.packetId, cmd.payload.packetId);
        assert.equal(payload.peerId, cmd.payload.peerId);
      });

      it('fails with RatesError when cross-asset and FX rate unavailable', async () => {
        const intent = makeLocalIntent({ assetCode: 'XRP', assetScale: 6 });
        await repo.storeMany([intent]);
        mockPalService.getRates = async () => null;

        const cmd = makeCalculateRemoteQuoteCmd({
          paymentIntentId: intent.id,
          peerAssetCode: 'USD',
          peerAssetScale: 2,
          sourceAmount: '100'
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, RemoteQuoteCalculationFailedEvent.name);
        const payload = (events[0] as RemoteQuoteCalculationFailedEvent)
          .payload;
        assert.equal(payload.errorName, 'RatesError');
      });

      it('fails with original error when FX fetch throws', async () => {
        const intent = makeLocalIntent({ assetCode: 'XRP', assetScale: 6 });
        await repo.storeMany([intent]);
        mockPalService.getRates = async () => {
          throw new Error('PAL exploded');
        };

        const cmd = makeCalculateRemoteQuoteCmd({
          paymentIntentId: intent.id,
          peerAssetCode: 'USD',
          peerAssetScale: 2,
          sourceAmount: '100'
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, RemoteQuoteCalculationFailedEvent.name);
        const payload = (events[0] as RemoteQuoteCalculationFailedEvent)
          .payload;
        assert.equal(payload.errorName, 'Error');
        assert.equal(payload.message, 'PAL exploded');
      });
    });

    describe('handleValidateInboundPaymentCommand', () => {
      function makeLocalIntent(
        overrides: Partial<{
          assetCode: string;
          assetScale: number;
          state: IPaymentIntent['state'];
          destination: IPaymentIntent['destination'];
          expiresAt: Date;
        }> = {}
      ): IPaymentIntent {
        return {
          id: crypto.randomUUID(),
          receivedAmount: 0n,
          receiverWalletAddress: 'domain.com/alice',
          receiverWalletAddressId: 'wallet-1',
          assetCode: overrides.assetCode ?? 'USD',
          assetScale: overrides.assetScale ?? 2,
          state: overrides.state ?? 'CREATED',
          destination: overrides.destination ?? 'LOCAL',
          createdAt: new Date(),
          expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000),
          incomingAmount: null,
          quotes: [],
          sentPayments: [],
          inboundPayments: []
        };
      }

      function makeValidateInboundPaymentCmd(
        overrides: Partial<{
          id: string;
          paymentIntentId: string;
          packetId: string;
          peerId: string;
          sourceAmount: string;
          peerAssetCode: string;
          peerAssetScale: number;
          expiresAt: string;
        }> = {}
      ): ValidateInboundPaymentCmd {
        const peerId = overrides.peerId ?? 'peer-1';
        mockPalService.setPeerById({
          peerId,
          assetCode: overrides.peerAssetCode ?? 'USD',
          assetScale: overrides.peerAssetScale ?? 2
        });
        return new ValidateInboundPaymentCmd(
          {
            id: overrides.id ?? crypto.randomUUID(),
            paymentIntentId: overrides.paymentIntentId ?? crypto.randomUUID(),
            packetId: overrides.packetId ?? crypto.randomUUID(),
            peerId,
            sourceAmount: overrides.sourceAmount ?? '100',
            expiresAt: overrides.expiresAt
          },
          crypto.randomUUID()
        );
      }

      it('same-asset: emits InboundPaymentValidatedEvent with receiveAmount = sourceAmount', async () => {
        const intent = makeLocalIntent({ assetCode: 'USD', assetScale: 2 });
        await repo.storeMany([intent]);

        const cmd = makeValidateInboundPaymentCmd({
          paymentIntentId: intent.id,
          sourceAmount: '100'
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, InboundPaymentValidatedEvent.name);
        const payload = (events[0] as InboundPaymentValidatedEvent).payload;
        assert.equal(payload.paymentIntentId, intent.id);
        assert.equal(payload.inboundPaymentId, cmd.payload.id);
        assert.equal(payload.packetId, cmd.payload.packetId);
        assert.equal(payload.peerId, cmd.payload.peerId);
        assert.equal(payload.sourceAmount, '100');
        assert.equal(payload.receiveAmount, '100');
        assert.equal(payload.receiveAssetCode, 'USD');
        assert.equal(payload.receiveAssetScale, 2);
        assert.equal(payload.receiverWalletAddressId, 'wallet-1');
        assert.equal(payload.state, 'VALIDATED');
      });

      it('stores expiresAt on the inbound payment', async () => {
        const intent = makeLocalIntent({ assetCode: 'USD', assetScale: 2 });
        await repo.storeMany([intent]);
        const expiresAt = new Date(Date.now() + 30_000).toISOString();

        const cmd = makeValidateInboundPaymentCmd({
          paymentIntentId: intent.id,
          expiresAt
        });
        const { events } = await aggregate.handleBatch([cmd]);
        await aggregate.flush();

        assert.equal(events[0].msgName, InboundPaymentValidatedEvent.name);
        const stored = await repo.fetchByIdsWithPayments([intent.id]);
        assert.equal(stored.length, 1);
        assert.equal(stored[0].inboundPayments.length, 1);
        assert.equal(
          stored[0].inboundPayments[0].expiresAt?.toISOString(),
          expiresAt
        );
      });

      it('cross-asset: converts sourceAmount using FX rate and scale diff', async () => {
        // peer EUR/2, receiver XRP/4, 1 EUR = 2 XRP
        const intent = makeLocalIntent({ assetCode: 'XRP', assetScale: 4 });
        await repo.storeMany([intent]);
        mockPalService.getRates = async () => 2;
        mockPalService.setPeerById({
          peerId: 'peer-1',
          assetCode: 'EUR',
          assetScale: 2
        });

        const cmd = makeValidateInboundPaymentCmd({
          paymentIntentId: intent.id,
          sourceAmount: '100'
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, InboundPaymentValidatedEvent.name);
        const payload = (events[0] as InboundPaymentValidatedEvent).payload;
        // scaleDiff = 2, floor(100 * 2 * 100) = 20000
        assert.equal(payload.receiveAmount, '20000');
        assert.equal(payload.receiveAssetCode, 'XRP');
        assert.equal(payload.receiveAssetScale, 4);
      });

      it('persists the inbound payment after flush', async () => {
        const intent = makeLocalIntent();
        await repo.storeMany([intent]);

        const cmd = makeValidateInboundPaymentCmd({
          paymentIntentId: intent.id,
          sourceAmount: '250'
        });
        await aggregate.handleBatch([cmd]);
        await aggregate.flush();

        const stored = repo.getAll().find((p) => p.id === intent.id);
        assert(stored);
        assert.equal(stored.inboundPayments.length, 1);
        const inboundPayment = stored.inboundPayments[0];
        assert.equal(inboundPayment.id, cmd.payload.id);
        assert.equal(inboundPayment.state, 'VALIDATED');
        assert.equal(inboundPayment.paymentIntentId, intent.id);
        assert.equal(inboundPayment.packetId, cmd.payload.packetId);
        assert.equal(inboundPayment.peerId, cmd.payload.peerId);
        assert.equal(inboundPayment.sourceAmount, 250n);
        assert.equal(inboundPayment.receiveAmount, 250n);
      });

      it('fails with PaymentIntentNotFoundError when intent missing', async () => {
        const cmd = makeValidateInboundPaymentCmd({
          paymentIntentId: 'nonexistent'
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(
          events[0].msgName,
          InboundPaymentValidationFailedEvent.name
        );
        const payload = (events[0] as InboundPaymentValidationFailedEvent)
          .payload;
        assert.equal(payload.errorName, 'PaymentIntentNotFoundError');
        assert.equal(payload.paymentIntentId, 'nonexistent');
        assert.equal(payload.inboundPaymentId, cmd.payload.id);
        assert.equal(payload.packetId, cmd.payload.packetId);
        assert.equal(payload.peerId, cmd.payload.peerId);
      });

      it('fails with PaymentIntentInvalidState when intent destination is REMOTE', async () => {
        const intent = makeLocalIntent({ destination: 'REMOTE' });
        await repo.storeMany([intent]);

        const cmd = makeValidateInboundPaymentCmd({
          paymentIntentId: intent.id
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(
          events[0].msgName,
          InboundPaymentValidationFailedEvent.name
        );
        const payload = (events[0] as InboundPaymentValidationFailedEvent)
          .payload;
        assert.equal(payload.errorName, 'PaymentIntentInvalidState');
      });

      it('fails with PaymentIntentInvalidState when intent is COMPLETED', async () => {
        const intent = makeLocalIntent({ state: 'COMPLETED' });
        await repo.storeMany([intent]);

        const cmd = makeValidateInboundPaymentCmd({
          paymentIntentId: intent.id
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(
          events[0].msgName,
          InboundPaymentValidationFailedEvent.name
        );
        const payload = (events[0] as InboundPaymentValidationFailedEvent)
          .payload;
        assert.equal(payload.errorName, 'PaymentIntentInvalidState');
      });

      it('fails with PaymentIntentExpired when intent is expired', async () => {
        const intent = makeLocalIntent({
          expiresAt: new Date(Date.now() - 1000)
        });
        await repo.storeMany([intent]);

        const cmd = makeValidateInboundPaymentCmd({
          paymentIntentId: intent.id
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(
          events[0].msgName,
          InboundPaymentValidationFailedEvent.name
        );
        const payload = (events[0] as InboundPaymentValidationFailedEvent)
          .payload;
        assert.equal(payload.errorName, 'PaymentIntentExpired');
      });

      it('fails with InvalidPaymentAmountError when sourceAmount is not positive', async () => {
        const intent = makeLocalIntent();
        await repo.storeMany([intent]);

        const cmd = makeValidateInboundPaymentCmd({
          paymentIntentId: intent.id,
          sourceAmount: '0'
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(
          events[0].msgName,
          InboundPaymentValidationFailedEvent.name
        );
        const payload = (events[0] as InboundPaymentValidationFailedEvent)
          .payload;
        assert.equal(payload.errorName, 'InvalidPaymentAmountError');
      });

      it('fails with InvalidPaymentIdError on duplicate inbound payment id', async () => {
        const intent = makeLocalIntent();
        await repo.storeMany([intent]);

        const inboundPaymentId = crypto.randomUUID();
        const cmd1 = makeValidateInboundPaymentCmd({
          id: inboundPaymentId,
          paymentIntentId: intent.id
        });
        const cmd2 = makeValidateInboundPaymentCmd({
          id: inboundPaymentId,
          paymentIntentId: intent.id
        });
        const { events } = await aggregate.handleBatch([cmd1, cmd2]);

        assert.equal(events.length, 2);
        assert.equal(events[0].msgName, InboundPaymentValidatedEvent.name);
        assert.equal(
          events[1].msgName,
          InboundPaymentValidationFailedEvent.name
        );
        const payload = (events[1] as InboundPaymentValidationFailedEvent)
          .payload;
        assert.equal(payload.errorName, 'InvalidPaymentIdError');
      });

      it('fails with RatesError when cross-asset and FX rate unavailable', async () => {
        const intent = makeLocalIntent({ assetCode: 'XRP', assetScale: 6 });
        await repo.storeMany([intent]);
        mockPalService.getRates = async () => null;

        const cmd = makeValidateInboundPaymentCmd({
          paymentIntentId: intent.id
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(
          events[0].msgName,
          InboundPaymentValidationFailedEvent.name
        );
        const payload = (events[0] as InboundPaymentValidationFailedEvent)
          .payload;
        assert.equal(payload.errorName, 'RatesError');
      });

      it('fails with PeerNotFoundError when PAL has no peer for peerId', async () => {
        const intent = makeLocalIntent({ assetCode: 'USD', assetScale: 2 });
        await repo.storeMany([intent]);
        mockPalService.getPeerById = async () => null;

        const cmd = makeValidateInboundPaymentCmd({
          paymentIntentId: intent.id
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(
          events[0].msgName,
          InboundPaymentValidationFailedEvent.name
        );
        const payload = (events[0] as InboundPaymentValidationFailedEvent)
          .payload;
        assert.equal(payload.errorName, 'PeerNotFoundError');
      });
    });

    describe('handleAcceptInboundPaymentCommand / handleFailInboundPaymentCommand', () => {
      function makeIntentWithInboundPayment(
        inboundPaymentState: IPaymentIntent['inboundPayments'][number]['state'] = 'VALIDATED'
      ): { intent: IPaymentIntent; inboundPaymentId: string } {
        const intentId = crypto.randomUUID();
        const inboundPaymentId = crypto.randomUUID();
        const intent: IPaymentIntent = {
          id: intentId,
          receivedAmount: 0n,
          receiverWalletAddress: 'domain.com/alice',
          receiverWalletAddressId: 'wallet-1',
          assetCode: 'USD',
          assetScale: 2,
          state: 'CREATED',
          destination: 'LOCAL',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          incomingAmount: null,
          quotes: [],
          sentPayments: [],
          inboundPayments: [
            {
              id: inboundPaymentId,
              state: inboundPaymentState,
              paymentIntentId: intentId,
              packetId: 'packet-1',
              peerId: 'peer-1',
              peerAssetCode: 'USD',
              peerAssetScale: 2,
              sourceAmount: 100n,
              receiveAmount: 100n,
              createdAt: new Date()
            }
          ]
        };
        return { intent, inboundPaymentId };
      }

      it('accepts a VALIDATED inbound payment and emits InboundPaymentAcceptedEvent', async () => {
        const { intent, inboundPaymentId } = makeIntentWithInboundPayment();
        await repo.storeMany([intent]);

        const cmd = new AcceptInboundPaymentCmd(
          {
            inboundPaymentId,
            paymentIntentId: intent.id,
            ledgerTransferId: 'transfer-1'
          },
          crypto.randomUUID()
        );
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, InboundPaymentAcceptedEvent.name);
        const payload = (events[0] as InboundPaymentAcceptedEvent).payload;
        assert.equal(payload.paymentIntentId, intent.id);
        assert.equal(payload.inboundPaymentId, inboundPaymentId);
        assert.equal(payload.packetId, 'packet-1');
        assert.equal(payload.peerId, 'peer-1');
        assert.equal(payload.ledgerTransferId, 'transfer-1');
        assert.equal(payload.receiveAmount, '100');
        assert.equal(payload.receiveAssetCode, 'USD');
        assert.equal(payload.receiveAssetScale, 2);
        assert.equal(payload.state, 'ACCEPTED');
      });

      it('persists the accepted state and ledgerTransferId after flush', async () => {
        const { intent, inboundPaymentId } = makeIntentWithInboundPayment();
        await repo.storeMany([intent]);

        const cmd = new AcceptInboundPaymentCmd(
          {
            inboundPaymentId,
            paymentIntentId: intent.id,
            ledgerTransferId: 'transfer-1'
          },
          crypto.randomUUID()
        );
        await aggregate.handleBatch([cmd]);
        await aggregate.flush();

        const stored = repo
          .getAll()
          .flatMap((p) => p.inboundPayments)
          .find((rp) => rp.id === inboundPaymentId);
        assert(stored);
        assert.equal(stored.state, 'ACCEPTED');
        assert.equal(stored.ledgerTransferId, 'transfer-1');
      });

      it('fails to accept from a non-VALIDATED state', async () => {
        const { intent, inboundPaymentId } =
          makeIntentWithInboundPayment('ACCEPTED');
        await repo.storeMany([intent]);

        const cmd = new AcceptInboundPaymentCmd(
          {
            inboundPaymentId,
            paymentIntentId: intent.id,
            ledgerTransferId: 'transfer-1'
          },
          crypto.randomUUID()
        );
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events[0].msgName, InboundPaymentFailedEvent.name);
        const payload = (events[0] as InboundPaymentFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentInvalidStateError');
      });

      it('fails to accept when the payment intent is missing', async () => {
        const cmd = new AcceptInboundPaymentCmd(
          {
            inboundPaymentId: crypto.randomUUID(),
            paymentIntentId: 'nonexistent',
            ledgerTransferId: 'transfer-1'
          },
          crypto.randomUUID()
        );
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events[0].msgName, InboundPaymentFailedEvent.name);
        const payload = (events[0] as InboundPaymentFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentIntentNotFoundError');
      });

      it('fails to accept when the inbound payment is missing', async () => {
        const { intent } = makeIntentWithInboundPayment();
        await repo.storeMany([intent]);

        const cmd = new AcceptInboundPaymentCmd(
          {
            inboundPaymentId: 'nonexistent',
            paymentIntentId: intent.id,
            ledgerTransferId: 'transfer-1'
          },
          crypto.randomUUID()
        );
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events[0].msgName, InboundPaymentFailedEvent.name);
        const payload = (events[0] as InboundPaymentFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentNotFoundError');
      });

      it('fails a VALIDATED inbound payment and persists failReason', async () => {
        const { intent, inboundPaymentId } = makeIntentWithInboundPayment();
        await repo.storeMany([intent]);

        const cmd = new FailInboundPaymentCmd(
          {
            inboundPaymentId,
            paymentIntentId: intent.id,
            reason: 'Insufficient funds'
          },
          crypto.randomUUID()
        );
        const { events } = await aggregate.handleBatch([cmd]);
        await aggregate.flush();

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, InboundPaymentFailedEvent.name);
        const payload = (events[0] as InboundPaymentFailedEvent).payload;
        assert.equal(payload.inboundPaymentId, inboundPaymentId);
        assert.equal(payload.packetId, 'packet-1');
        assert.equal(payload.message, 'Insufficient funds');

        const stored = repo
          .getAll()
          .flatMap((p) => p.inboundPayments)
          .find((rp) => rp.id === inboundPaymentId);
        assert(stored);
        assert.equal(stored.state, 'FAILED');
        assert.equal(stored.failReason, 'Insufficient funds');
      });

      it('fails an ACCEPTED inbound payment', async () => {
        const { intent, inboundPaymentId } =
          makeIntentWithInboundPayment('ACCEPTED');
        await repo.storeMany([intent]);

        const cmd = new FailInboundPaymentCmd(
          {
            inboundPaymentId,
            paymentIntentId: intent.id,
            reason: 'Ledger transfer rejected'
          },
          crypto.randomUUID()
        );
        await aggregate.handleBatch([cmd]);
        await aggregate.flush();

        const stored = repo
          .getAll()
          .flatMap((p) => p.inboundPayments)
          .find((rp) => rp.id === inboundPaymentId);
        assert(stored);
        assert.equal(stored.state, 'FAILED');
      });

      it('fails a FULFILLABLE inbound payment', async () => {
        const { intent, inboundPaymentId } =
          makeIntentWithInboundPayment('FULFILLABLE');
        await repo.storeMany([intent]);

        const cmd = new FailInboundPaymentCmd(
          {
            inboundPaymentId,
            paymentIntentId: intent.id,
            reason: 'ILP fulfillment failed'
          },
          crypto.randomUUID()
        );
        await aggregate.handleBatch([cmd]);
        await aggregate.flush();

        const stored = repo
          .getAll()
          .flatMap((p) => p.inboundPayments)
          .find((rp) => rp.id === inboundPaymentId);
        assert(stored);
        assert.equal(stored.state, 'FAILED');
      });

      it('cannot fail a FINALIZED inbound payment', async () => {
        const { intent, inboundPaymentId } =
          makeIntentWithInboundPayment('FINALIZED');
        await repo.storeMany([intent]);

        const cmd = new FailInboundPaymentCmd(
          {
            inboundPaymentId,
            paymentIntentId: intent.id,
            reason: 'too late'
          },
          crypto.randomUUID()
        );
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events[0].msgName, InboundPaymentFailedEvent.name);
        const payload = (events[0] as InboundPaymentFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentInvalidStateError');
      });
    });

    describe('handleMarkInboundPaymentFulfillableCommand', () => {
      function makeIntentWithInboundPayment(
        state: IPaymentIntent['inboundPayments'][number]['state'] = 'ACCEPTED'
      ): { intent: IPaymentIntent; inboundPaymentId: string } {
        const intentId = crypto.randomUUID();
        const inboundPaymentId = crypto.randomUUID();
        const intent: IPaymentIntent = {
          id: intentId,
          receivedAmount: 0n,
          receiverWalletAddress: 'domain.com/alice',
          receiverWalletAddressId: 'wallet-1',
          assetCode: 'USD',
          assetScale: 2,
          state: 'CREATED',
          destination: 'LOCAL',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          incomingAmount: null,
          quotes: [],
          sentPayments: [],
          inboundPayments: [
            {
              id: inboundPaymentId,
              state,
              paymentIntentId: intentId,
              packetId: 'packet-1',
              peerId: 'peer-1',
              peerAssetCode: 'USD',
              peerAssetScale: 2,
              sourceAmount: 100n,
              receiveAmount: 100n,
              createdAt: new Date(),
              ledgerTransferId: 'transfer-1'
            }
          ]
        };
        return { intent, inboundPaymentId };
      }

      it('marks an ACCEPTED inbound payment FULFILLABLE and emits InboundPaymentFulfillableEvent', async () => {
        const { intent, inboundPaymentId } = makeIntentWithInboundPayment();
        await repo.storeMany([intent]);

        const { events } = await aggregate.handleBatch([
          new MarkInboundPaymentFulfillableCmd(
            { inboundPaymentId, paymentIntentId: intent.id },
            crypto.randomUUID()
          )
        ]);
        await aggregate.flush();

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, InboundPaymentFulfillableEvent.name);
        const payload = (events[0] as InboundPaymentFulfillableEvent).payload;
        assert.equal(payload.paymentIntentId, intent.id);
        assert.equal(payload.inboundPaymentId, inboundPaymentId);
        assert.equal(payload.packetId, 'packet-1');
        assert.equal(payload.peerId, 'peer-1');
        assert.equal(payload.receiveAmount, '100');
        assert.equal(payload.receiveAssetCode, 'USD');
        assert.equal(payload.receiveAssetScale, 2);
        assert.equal(payload.state, 'FULFILLABLE');

        const stored = repo.getAll().find((p) => p.id === intent.id);
        assert(stored);
        assert.equal(stored.inboundPayments[0].state, 'FULFILLABLE');
        // receivedAmount is only credited at finalize, not here
        assert.equal(stored.receivedAmount, 0n);
      });

      it('cannot mark a VALIDATED inbound payment fulfillable', async () => {
        const { intent, inboundPaymentId } =
          makeIntentWithInboundPayment('VALIDATED');
        await repo.storeMany([intent]);

        const { events } = await aggregate.handleBatch([
          new MarkInboundPaymentFulfillableCmd(
            { inboundPaymentId, paymentIntentId: intent.id },
            crypto.randomUUID()
          )
        ]);

        assert.equal(events[0].msgName, InboundPaymentFailedEvent.name);
        const payload = (events[0] as InboundPaymentFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentInvalidStateError');
      });
    });

    describe('handleFinalizeInboundPaymentCommand', () => {
      function makeIntentWithInboundPayment(overrides?: {
        inboundPaymentState?: IPaymentIntent['inboundPayments'][number]['state'];
        incomingAmount?: bigint | null;
        receiveAmount?: bigint;
      }): { intent: IPaymentIntent; inboundPaymentId: string } {
        const intentId = crypto.randomUUID();
        const inboundPaymentId = crypto.randomUUID();
        const intent: IPaymentIntent = {
          id: intentId,
          receivedAmount: 0n,
          receiverWalletAddress: 'domain.com/alice',
          receiverWalletAddressId: 'wallet-1',
          assetCode: 'USD',
          assetScale: 2,
          state: 'CREATED',
          destination: 'LOCAL',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          incomingAmount: overrides?.incomingAmount ?? null,
          quotes: [],
          sentPayments: [],
          inboundPayments: [
            {
              id: inboundPaymentId,
              state: overrides?.inboundPaymentState ?? 'FULFILLABLE',
              paymentIntentId: intentId,
              packetId: 'packet-1',
              peerId: 'peer-1',
              peerAssetCode: 'USD',
              peerAssetScale: 2,
              sourceAmount: 100n,
              receiveAmount: overrides?.receiveAmount ?? 100n,
              createdAt: new Date(),
              ledgerTransferId: 'transfer-1'
            }
          ]
        };
        return { intent, inboundPaymentId };
      }

      function makeFinalizeCmd(
        inboundPaymentId: string,
        paymentIntentId: string
      ): FinalizeInboundPaymentCmd {
        return new FinalizeInboundPaymentCmd(
          { inboundPaymentId, paymentIntentId },
          crypto.randomUUID()
        );
      }

      it('finalizes an ACCEPTED inbound payment and accumulates receivedAmount', async () => {
        const { intent, inboundPaymentId } = makeIntentWithInboundPayment();
        await repo.storeMany([intent]);

        const { events } = await aggregate.handleBatch([
          makeFinalizeCmd(inboundPaymentId, intent.id)
        ]);
        await aggregate.flush();

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, InboundPaymentFinalizedEvent.name);
        const payload = (events[0] as InboundPaymentFinalizedEvent).payload;
        assert.equal(payload.paymentIntentId, intent.id);
        assert.equal(payload.inboundPaymentId, inboundPaymentId);
        assert.equal(payload.packetId, 'packet-1');
        assert.equal(payload.peerId, 'peer-1');
        assert.equal(payload.sourceAmount, '100');
        assert.equal(payload.receiveAmount, '100');
        assert.equal(payload.receiveAssetCode, 'USD');
        assert.equal(payload.receiveAssetScale, 2);
        assert.equal(payload.state, 'FINALIZED');

        const stored = repo.getAll().find((p) => p.id === intent.id);
        assert(stored);
        assert.equal(stored.receivedAmount, 100n);
        assert.equal(stored.state, 'CREATED'); // no incomingAmount -> not completed
        assert.equal(stored.inboundPayments[0].state, 'FINALIZED');
      });

      it('completes the intent and emits PaymentIntentCompletedEvent when incomingAmount is met', async () => {
        const { intent, inboundPaymentId } = makeIntentWithInboundPayment({
          incomingAmount: 100n
        });
        await repo.storeMany([intent]);

        const { events } = await aggregate.handleBatch([
          makeFinalizeCmd(inboundPaymentId, intent.id)
        ]);
        await aggregate.flush();

        assert.equal(events.length, 2);
        assert.equal(events[0].msgName, InboundPaymentFinalizedEvent.name);
        assert.equal(events[1].msgName, PaymentIntentCompletedEvent.name);
        const intentPayload = (events[1] as PaymentIntentCompletedEvent)
          .payload;
        assert.equal(intentPayload.receivedAmount, '100');
        assert.equal(intentPayload.state, 'COMPLETED');

        const stored = repo.getAll().find((p) => p.id === intent.id);
        assert(stored);
        assert.equal(stored.state, 'COMPLETED');
      });

      it('accumulates receivedAmount across multiple finalized payments', async () => {
        const intentId = crypto.randomUUID();
        const rp = (id: string) => ({
          id,
          state: 'FULFILLABLE' as const,
          paymentIntentId: intentId,
          packetId: crypto.randomUUID(),
          peerId: 'peer-1',
          peerAssetCode: 'USD',
          peerAssetScale: 2,
          sourceAmount: 60n,
          receiveAmount: 60n,
          createdAt: new Date(),
          ledgerTransferId: crypto.randomUUID()
        });
        const intent: IPaymentIntent = {
          id: intentId,
          receivedAmount: 0n,
          receiverWalletAddress: 'domain.com/alice',
          receiverWalletAddressId: 'wallet-1',
          assetCode: 'USD',
          assetScale: 2,
          state: 'CREATED',
          destination: 'LOCAL',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          incomingAmount: 120n,
          quotes: [],
          sentPayments: [],
          inboundPayments: [rp('rp-1'), rp('rp-2')]
        };
        await repo.storeMany([intent]);

        const { events } = await aggregate.handleBatch([
          makeFinalizeCmd('rp-1', intentId),
          makeFinalizeCmd('rp-2', intentId)
        ]);
        await aggregate.flush();

        // rp-1 finalized, rp-2 finalized + intent completed
        assert.equal(events.length, 3);
        assert.equal(events[2].msgName, PaymentIntentCompletedEvent.name);

        const stored = repo.getAll().find((p) => p.id === intentId);
        assert(stored);
        assert.equal(stored.receivedAmount, 120n);
        assert.equal(stored.state, 'COMPLETED');
        assert(stored.inboundPayments.every((r) => r.state === 'FINALIZED'));
      });

      it('fails to finalize from a non-ACCEPTED state', async () => {
        const { intent, inboundPaymentId } = makeIntentWithInboundPayment({
          inboundPaymentState: 'VALIDATED'
        });
        await repo.storeMany([intent]);

        const { events } = await aggregate.handleBatch([
          makeFinalizeCmd(inboundPaymentId, intent.id)
        ]);

        assert.equal(events[0].msgName, InboundPaymentFailedEvent.name);
        const payload = (events[0] as InboundPaymentFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentInvalidStateError');
      });

      it('fails to finalize when the payment intent is missing', async () => {
        const { events } = await aggregate.handleBatch([
          makeFinalizeCmd(crypto.randomUUID(), 'nonexistent')
        ]);

        assert.equal(events[0].msgName, InboundPaymentFailedEvent.name);
        const payload = (events[0] as InboundPaymentFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentIntentNotFoundError');
      });

      it('fails to finalize when the inbound payment is missing', async () => {
        const { intent } = makeIntentWithInboundPayment();
        await repo.storeMany([intent]);

        const { events } = await aggregate.handleBatch([
          makeFinalizeCmd('nonexistent', intent.id)
        ]);

        assert.equal(events[0].msgName, InboundPaymentFailedEvent.name);
        const payload = (events[0] as InboundPaymentFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentNotFoundError');
      });
    });

    describe('handleCreateQuoteCommand (remote url)', () => {
      const REMOTE_URL = 'https://remote.domain.com/incoming-payments/abc';

      beforeEach(() => {
        mockRemotePaymentIntentService.setIncomingPaymentResponse(
          toIncomingPaymentWithMethods({
            id: 'abc',
            walletAddress: 'remote.domain.com/alice',
            assetCode: 'USD',
            assetScale: 2,
            receivedAmountValue: '0',
            ilpAddress: 'g.peer.123',
            sharedSecret: 'stub-shared-secret'
          })
        );
      });

      it('fetches remote intent (OP methods shape) and emits RemoteQuoteRequestedEvent', async () => {
        const cmd = makeCreateQuoteCmd({
          remotePaymentIntentUrl: REMOTE_URL,
          debitAmount: 500
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, RemoteQuoteRequestedEvent.name);
        const payload = (events[0] as RemoteQuoteRequestedEvent).payload;
        assert.equal(payload.paymentIntentId, cmd.payload.paymentIntentId);
        assert.equal(payload.quoteId, cmd.payload.id);
        assert.equal(payload.peerId, 'peer-1');
        assert.equal(payload.receiverWalletAddress, 'remote.domain.com/alice');
        assert.equal(
          payload.senderWalletAddress,
          cmd.payload.senderWalletAddress
        );
        assert.equal(payload.senderAssetCode, 'USD');
        assert.equal(payload.senderAssetScale, 2);
      });

      it('deduplicates intra-batch: second cmd with same url uses first intent id', async () => {
        let fetchCount = 0;
        const originalFetch =
          mockRemotePaymentIntentService.fetchPaymentIntent.bind(
            mockRemotePaymentIntentService
          );
        mockRemotePaymentIntentService.fetchPaymentIntent = async (url) => {
          fetchCount++;
          return originalFetch(url);
        };

        const cmd1 = makeCreateQuoteCmd({
          remotePaymentIntentUrl: REMOTE_URL,
          debitAmount: 100
        });
        const cmd2 = makeCreateQuoteCmd({
          remotePaymentIntentUrl: REMOTE_URL,
          debitAmount: 200
        });
        const { events } = await aggregate.handleBatch([cmd1, cmd2]);

        assert.equal(fetchCount, 1);
        assert.equal(events.length, 2);
        assert.equal(events[0].msgName, RemoteQuoteRequestedEvent.name);
        assert.equal(events[1].msgName, RemoteQuoteRequestedEvent.name);
        const p1 = (events[0] as RemoteQuoteRequestedEvent).payload;
        const p2 = (events[1] as RemoteQuoteRequestedEvent).payload;
        assert.equal(p1.paymentIntentId, cmd1.payload.paymentIntentId);
        assert.equal(p2.paymentIntentId, cmd1.payload.paymentIntentId);
      });

      it('deduplicates cross-batch: uses existing intent id when url already imported', async () => {
        const existingPaymentIntent: IPaymentIntent = {
          id: crypto.randomUUID(),
          receivedAmount: 0n,
          receiverWalletAddress: 'remote.domain.com/alice',
          assetCode: 'USD',
          assetScale: 2,
          state: 'CREATED',
          destination: 'REMOTE',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          incomingAmount: null,
          quotes: [],
          sentPayments: [],
          inboundPayments: [],
          destinationIlpAddress: 'g.peer.123',
          remoteUrl: REMOTE_URL
        };
        await repo.storeMany([existingPaymentIntent]);

        const cmd = makeCreateQuoteCmd({
          remotePaymentIntentUrl: REMOTE_URL,
          debitAmount: 300
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, RemoteQuoteRequestedEvent.name);
        const payload = (events[0] as RemoteQuoteRequestedEvent).payload;
        assert.equal(payload.paymentIntentId, existingPaymentIntent.id);
      });

      it('emits QuoteCreateFailedEvent when remote fetch throws', async () => {
        mockRemotePaymentIntentService.fetchPaymentIntent = async () => {
          throw new Error('Connection refused');
        };

        const cmd = makeCreateQuoteCmd({ remotePaymentIntentUrl: REMOTE_URL });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, QuoteCreateFailedEvent.name);
        const payload = (events[0] as QuoteCreateFailedEvent).payload;
        assert.equal(payload.paymentIntentId, cmd.payload.paymentIntentId);
        assert.match(payload.message, /Connection refused/);
      });

      it('emits QuoteCreateFailedEvent when OP response has no ILP method', async () => {
        mockRemotePaymentIntentService.setIncomingPaymentResponse({
          id: 'abc',
          completed: false,
          walletAddress: 'remote.domain.com/alice',
          createdAt: new Date().toISOString(),
          receivedAmount: {
            value: '0',
            assetCode: 'USD',
            assetScale: 2
          },
          methods: []
        });

        const cmd = makeCreateQuoteCmd({ remotePaymentIntentUrl: REMOTE_URL });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, QuoteCreateFailedEvent.name);
        const payload = (events[0] as QuoteCreateFailedEvent).payload;
        assert.match(payload.message, /sharedSecret/);
      });
    });

    describe('handleCreatePaymentCommand', () => {
      it('fails when sender wallet address not found', async () => {
        const quoteCmd = makeCreatePaymentCmd({
          senderWalletAddressId: 'nonexistent',
          grantId: 'grant-1'
        });
        const { events } = await aggregate.handleBatch([quoteCmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCreateFailedEvent.name);
        assert.equal(events[0].msgKey, quoteCmd.payload.paymentIntentId);
        const payload = (events[0] as PaymentCreateFailedEvent).payload;
        assert.equal(payload.errorName, 'WalletAddressNotFoundError');
        assert.match(payload.message, /Wallet address nonexistent not found/);
        assert.equal(payload.grantId, 'grant-1');
      });

      it('fails when sender wallet address is inactive', async () => {
        mockPalService.addWalletAddress({
          id: 'inactive-sender',
          isActive: false,
          assetCode: 'USD',
          assetScale: 2
        });

        const quoteCmd = makeCreatePaymentCmd({
          senderWalletAddressId: 'inactive-sender'
        });
        const { events } = await aggregate.handleBatch([quoteCmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCreateFailedEvent.name);
        const payload = (events[0] as PaymentCreateFailedEvent).payload;
        assert.equal(payload.errorName, 'WalletAddressInactiveError');
      });

      it('fails when payment intent not found', async () => {
        const quoteCmd = makeCreatePaymentCmd({
          paymentIntentId: 'nonexistent'
        });
        const { events } = await aggregate.handleBatch([quoteCmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCreateFailedEvent.name);
        const payload = (events[0] as PaymentCreateFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentIntentNotFoundError');
      });

      it('fails if rates could not be fetched', async () => {
        const paymentIntent: IPaymentIntent = {
          id: crypto.randomUUID(),
          receivedAmount: 0n,
          receiverWalletAddress: 'receiver',
          receiverWalletAddressId: crypto.randomUUID(),
          assetCode: 'EUR',
          assetScale: 2,
          state: 'CREATED',
          destination: 'LOCAL',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 1000),
          incomingAmount: null,
          quotes: [],
          sentPayments: [],
          inboundPayments: []
        };
        await repo.storeMany([paymentIntent]);

        mockPalService.getRates = async () => null;

        const cmd = makeCreatePaymentCmd({
          paymentIntentId: paymentIntent.id
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCreateFailedEvent.name);
        const payload = (events[0] as PaymentCreateFailedEvent).payload;
        assert.equal(payload.errorName, 'RatesError');
      });

      it('creates local payment', async () => {
        const paymentIntent: IPaymentIntent = {
          id: crypto.randomUUID(),
          receivedAmount: 0n,
          receiverWalletAddress: 'receiver',
          receiverWalletAddressId: crypto.randomUUID(),
          assetCode: 'USD',
          assetScale: 2,
          state: 'CREATED',
          destination: 'LOCAL',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 1000),
          incomingAmount: null,
          quotes: [],
          sentPayments: [],
          inboundPayments: []
        };
        await repo.storeMany([paymentIntent]);

        const cmd = makeCreatePaymentCmd({
          paymentIntentId: paymentIntent.id,
          grantId: 'grant-1'
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCreatedEvent.name);
        const created = events[0] as PaymentCreatedEvent;
        assert.equal(created.payload.id, cmd.payload.id);
        assert.equal(created.msgKey, paymentIntent.id);

        await aggregate.flush();
        const stored = repo.getAll().find((p) => p.id === paymentIntent.id);
        assert.equal(stored?.sentPayments[0]?.grantId, 'grant-1');
      });

      it('creates remote payment from a completed quote', async () => {
        const paymentIntentId = crypto.randomUUID();
        const quoteId = crypto.randomUUID();
        const paymentIntent: IPaymentIntent = {
          id: paymentIntentId,
          receivedAmount: 0n,
          receiverWalletAddress: 'remote.domain.com/alice',
          assetCode: 'USD',
          assetScale: 2,
          state: 'CREATED',
          destination: 'REMOTE',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          incomingAmount: null,
          destinationIlpAddress: 'g.peer.123',
          quotes: [
            {
              id: quoteId,
              state: 'COMPLETED',
              senderWalletAddress: 'domain.com/bob',
              senderWalletAddressId: 'wallet-1',
              createdAt: new Date(),
              debitAmount: 500n,
              receiveAmount: 100n,
              exchangeRate: 0.2,
              route: {
                peerId: 'peer-1',
                peerAssetCode: 'USD',
                peerAssetScale: 2,
                sourceAmount: 100n,
                senderAssetCode: 'USD'
              },
              expiresAt: new Date(Date.now() + 60_000)
            }
          ],
          sentPayments: [],
          inboundPayments: []
        };
        await repo.storeMany([paymentIntent]);

        const cmd = makeCreatePaymentCmd({
          paymentIntentId,
          quoteId,
          grantId: 'grant-1'
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCreatedEvent.name);
        assert.equal(events[0].msgKey, paymentIntentId);
        const payload = (events[0] as PaymentCreatedEvent).payload;
        assert.equal(payload.id, cmd.payload.id);
        assert.equal(payload.paymentIntentId, paymentIntentId);
        assert.equal(payload.debitAmount, '500');
        assert.equal(payload.receiveAmount, '100');
        assert.equal(payload.state, 'CREATED');

        await aggregate.flush();
        const stored = repo.getAll().find((p) => p.id === paymentIntentId);
        assert.equal(stored?.sentPayments[0]?.grantId, 'grant-1');
      });

      describe('quoteless remote payment', () => {
        const REMOTE_URL = 'https://remote.domain.com/incoming-payments/abc';

        function makeRemoteIntent(
          overrides: Partial<IPaymentIntent> = {}
        ): IPaymentIntent {
          return {
            id: crypto.randomUUID(),
            receivedAmount: 0n,
            receiverWalletAddress: 'remote.domain.com/alice',
            assetCode: 'USD',
            assetScale: 2,
            state: 'CREATED',
            destination: 'REMOTE',
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
            incomingAmount: null,
            destinationIlpAddress: 'g.peer.123',
            quotes: [],
            sentPayments: [],
            inboundPayments: [],
            ...overrides
          };
        }

        beforeEach(() => {
          mockRemotePaymentIntentService.fetchPaymentIntent = async () => ({
            walletAddress: 'remote.domain.com/alice',
            assetCode: 'USD',
            assetScale: 2,
            receivedAmount: 0n,
            destinationIlpAddress: 'g.peer.123',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            sharedSecret: 'stub-shared-secret'
          });
        });

        it('fails when both quoteId and debitAmount are missing', async () => {
          const paymentIntent = makeRemoteIntent();
          await repo.storeMany([paymentIntent]);

          const cmd = makeCreatePaymentCmd({
            paymentIntentId: paymentIntent.id,
            quoteId: undefined,
            debitAmount: undefined
          });
          const { events } = await aggregate.handleBatch([cmd]);

          assert.equal(events.length, 1);
          assert.equal(events[0].msgName, PaymentCreateFailedEvent.name);
          const payload = (events[0] as PaymentCreateFailedEvent).payload;
          assert.equal(payload.errorName, 'InvalidPaymentAmountError');
          assert.match(payload.message, /requires a debitAmount/);
        });

        it('creates a quoteless payment against a locally known intent', async () => {
          const paymentIntent = makeRemoteIntent();
          await repo.storeMany([paymentIntent]);

          const cmd = makeCreatePaymentCmd({
            paymentIntentId: paymentIntent.id,
            debitAmount: 500
          });
          const { events } = await aggregate.handleBatch([cmd]);
          await aggregate.flush();

          assert.equal(events.length, 1);
          assert.equal(events[0].msgName, PaymentCreatedEvent.name);
          const payload = (events[0] as PaymentCreatedEvent).payload;
          assert.equal(payload.id, cmd.payload.id);
          assert.equal(payload.debitAmount, '500');
          assert.equal(payload.receiveAmount, null);
          assert.equal(payload.state, 'CREATED');

          const stored = repo.getAll().find((p) => p.id === paymentIntent.id);
          assert(stored);
          assert.equal(stored.sentPayments.length, 1);
          const storedPayment = stored.sentPayments[0];
          assert.ok(isRemoteSentPayment(storedPayment));
          assert.equal(storedPayment.peerId, 'peer-1');
          assert.equal(storedPayment.receiveAmount, null);
          assert.equal(storedPayment.debitAmount, 500n);
        });

        it('imports the remote intent when remoteUrl is provided', async () => {
          const cmd = makeCreatePaymentCmd({
            remotePaymentIntentUrl: REMOTE_URL,
            debitAmount: 500
          });
          const { events } = await aggregate.handleBatch([cmd]);

          assert.equal(events.length, 1);
          assert.equal(events[0].msgName, PaymentCreatedEvent.name);
          const payload = (events[0] as PaymentCreatedEvent).payload;
          assert.equal(payload.paymentIntentId, cmd.payload.paymentIntentId);
          assert.equal(payload.receiveAmount, null);
        });

        it('dedupes to the existing intent when the url was already imported', async () => {
          const existing = makeRemoteIntent({ remoteUrl: REMOTE_URL });
          await repo.storeMany([existing]);

          const cmd = makeCreatePaymentCmd({
            remotePaymentIntentUrl: REMOTE_URL,
            debitAmount: 500
          });
          const { events } = await aggregate.handleBatch([cmd]);

          assert.equal(events.length, 1);
          assert.equal(events[0].msgName, PaymentCreatedEvent.name);
          const payload = (events[0] as PaymentCreatedEvent).payload;
          assert.equal(payload.paymentIntentId, existing.id);
        });

        it('fails when the remote intent fetch throws', async () => {
          mockRemotePaymentIntentService.fetchPaymentIntent = async () => {
            throw new Error('Connection refused');
          };

          const cmd = makeCreatePaymentCmd({
            remotePaymentIntentUrl: REMOTE_URL,
            debitAmount: 500
          });
          const { events } = await aggregate.handleBatch([cmd]);

          assert.equal(events.length, 1);
          assert.equal(events[0].msgName, PaymentCreateFailedEvent.name);
          const payload = (events[0] as PaymentCreateFailedEvent).payload;
          assert.match(payload.message, /Connection refused/);
        });

        it('fails when no peer matches the destination ILP address', async () => {
          mockPalService.getPeerByIlpAddress = async () => null;
          const paymentIntent = makeRemoteIntent();
          await repo.storeMany([paymentIntent]);

          const cmd = makeCreatePaymentCmd({
            paymentIntentId: paymentIntent.id,
            debitAmount: 500
          });
          const { events } = await aggregate.handleBatch([cmd]);

          assert.equal(events.length, 1);
          assert.equal(events[0].msgName, PaymentCreateFailedEvent.name);
          const payload = (events[0] as PaymentCreateFailedEvent).payload;
          assert.equal(payload.errorName, 'PeerNotFoundError');
        });

        it('approves a quoteless payment for remote send', async () => {
          const paymentIntent = makeRemoteIntent();
          await repo.storeMany([paymentIntent]);

          const createCmd = makeCreatePaymentCmd({
            paymentIntentId: paymentIntent.id,
            debitAmount: 500
          });
          await aggregate.handleBatch([createCmd]);
          await aggregate.flush();

          const { events } = await aggregate.handleBatch([
            makeApprovePaymentCmd({
              id: createCmd.payload.id,
              paymentIntentId: paymentIntent.id
            })
          ]);

          assert.equal(events.length, 1);
          assert.equal(events[0].msgName, RemotePaymentSendApprovedEvent.name);
          const payload = (events[0] as RemotePaymentSendApprovedEvent).payload;
          assert.equal(payload.paymentId, createCmd.payload.id);
          assert.equal(payload.peerId, 'peer-1');
          assert.equal(payload.debitAmount, '500');
        });
      });
    });

    describe('handlePaymentApproveCommand', () => {
      it('fails when payment intent not found', async () => {
        const cmd = makeApprovePaymentCmd({
          paymentIntentId: 'nonexistent'
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCompleteFailedEvent.name);
        const payload = (events[0] as PaymentCompleteFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentIntentNotFoundError');
      });

      it('completes local payment', async () => {
        const paymentIntentId = crypto.randomUUID();
        const paymentId = crypto.randomUUID();
        const paymentIntent: IPaymentIntent = {
          id: paymentIntentId,
          receivedAmount: 0n,
          receiverWalletAddress: 'receiver',
          receiverWalletAddressId: crypto.randomUUID(),
          assetCode: 'USD',
          assetScale: 2,
          state: 'CREATED',
          destination: 'LOCAL',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 1000),
          incomingAmount: 100n,
          quotes: [],
          inboundPayments: [],
          sentPayments: [
            {
              destination: 'LOCAL',
              id: paymentId,
              state: 'CREATED',
              senderWalletAddress: 'sender',
              senderWalletAddressId: crypto.randomUUID(),
              assetCode: 'USD',
              paymentIntentId: paymentIntentId,
              assetScale: 2,
              createdAt: new Date(),
              debitAmount: 100n,
              receiveAmount: 100n,
              sentAmount: 0n,
              grantId: 'grant-1'
            }
          ]
        };
        await repo.storeMany([paymentIntent]);

        const cmd = makeApprovePaymentCmd({
          id: paymentId,
          paymentIntentId: paymentIntentId
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 2);
        assert.equal(events[0].msgName, PaymentCompletedEvent.name);
        const completed = (events[0] as PaymentCompletedEvent).payload;
        assert.equal(completed.id, paymentId);
        assert.equal(completed.grantId, 'grant-1');
        assert.equal(events[1].msgName, PaymentIntentCompletedEvent.name);
        assert.equal(
          (events[1] as PaymentIntentCompletedEvent).payload.id,
          paymentIntentId
        );
      });

      it('approves remote payment: emits RemotePaymentSendApprovedEvent and persists PROCESSING', async () => {
        const paymentIntentId = crypto.randomUUID();
        const paymentId = crypto.randomUUID();
        const quoteId = crypto.randomUUID();
        const senderWalletAddressId = 'wallet-1';
        const paymentIntent: IPaymentIntent = {
          id: paymentIntentId,
          receivedAmount: 0n,
          receiverWalletAddress: 'remote.domain.com/alice',
          assetCode: 'USD',
          assetScale: 2,
          state: 'CREATED',
          destination: 'REMOTE',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          incomingAmount: null,
          destinationIlpAddress: 'g.peer.123',
          quotes: [
            {
              id: quoteId,
              state: 'COMPLETED',
              senderWalletAddress: 'domain.com/bob',
              senderWalletAddressId,
              createdAt: new Date(),
              debitAmount: 500n,
              receiveAmount: 100n,
              exchangeRate: 0.2,
              expiresAt: new Date(Date.now() + 60_000)
            }
          ],
          inboundPayments: [],
          sentPayments: [
            {
              destination: 'REMOTE',
              peerId: 'peer-1',
              id: paymentId,
              state: 'CREATED',
              quoteId,
              senderWalletAddress: 'domain.com/bob',
              senderWalletAddressId,
              paymentIntentId,
              assetCode: 'USD',
              assetScale: 2,
              createdAt: new Date(),
              debitAmount: 500n,
              receiveAmount: 100n,
              sentAmount: 0n
            }
          ]
        };
        await repo.storeMany([paymentIntent]);

        const cmd = makeApprovePaymentCmd({
          id: paymentId,
          paymentIntentId
        });
        const { events } = await aggregate.handleBatch([cmd]);
        await aggregate.flush();

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, RemotePaymentSendApprovedEvent.name);
        const payload = (events[0] as RemotePaymentSendApprovedEvent).payload;
        assert.equal(payload.paymentIntentId, paymentIntentId);
        assert.equal(payload.paymentId, paymentId);
        assert.equal(payload.destinationIlpAddress, 'g.peer.123');
        assert.equal(payload.debitAmount, '500');
        assert.equal(payload.assetCode, 'USD');
        assert.equal(payload.assetScale, 2);
        assert.equal(payload.senderWalletAddressId, senderWalletAddressId);

        const stored = repo
          .getAll()
          .find((intent) => intent.id === paymentIntentId);
        assert.ok(stored);
        const storedPayment = stored.sentPayments.find(
          (p) => p.id === paymentId
        );
        assert.ok(storedPayment && isRemoteSentPayment(storedPayment));
        assert.equal(storedPayment.state, 'PROCESSING');
        assert.equal(storedPayment.ledgerTransferId, undefined);
      });

      it('fails to approve remote payment if intent has no destinationIlpAddress', async () => {
        const paymentIntentId = crypto.randomUUID();
        const paymentId = crypto.randomUUID();
        const paymentIntent: IPaymentIntent = {
          id: paymentIntentId,
          receivedAmount: 0n,
          receiverWalletAddress: 'remote.domain.com/alice',
          assetCode: 'USD',
          assetScale: 2,
          state: 'CREATED',
          destination: 'REMOTE',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          incomingAmount: null,
          quotes: [],
          inboundPayments: [],
          sentPayments: [
            {
              destination: 'REMOTE',
              peerId: 'peer-1',
              id: paymentId,
              state: 'CREATED',
              senderWalletAddress: 'domain.com/bob',
              senderWalletAddressId: 'wallet-1',
              paymentIntentId,
              assetCode: 'USD',
              assetScale: 2,
              createdAt: new Date(),
              debitAmount: 500n,
              receiveAmount: 100n,
              sentAmount: 0n
            }
          ]
        };
        await repo.storeMany([paymentIntent]);

        const cmd = makeApprovePaymentCmd({
          id: paymentId,
          paymentIntentId
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCompleteFailedEvent.name);
        const payload = (events[0] as PaymentCompleteFailedEvent).payload;
        assert.equal(payload.errorName, 'MissingDestinationIlpAddressError');
      });

      it('fails to approve remote payment when payment is already PROCESSING', async () => {
        const paymentIntentId = crypto.randomUUID();
        const paymentId = crypto.randomUUID();
        const paymentIntent: IPaymentIntent = {
          id: paymentIntentId,
          receivedAmount: 0n,
          receiverWalletAddress: 'remote.domain.com/alice',
          assetCode: 'USD',
          assetScale: 2,
          state: 'CREATED',
          destination: 'REMOTE',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          incomingAmount: null,
          destinationIlpAddress: 'g.peer.123',
          quotes: [],
          inboundPayments: [],
          sentPayments: [
            {
              destination: 'REMOTE',
              peerId: 'peer-1',
              id: paymentId,
              state: 'PROCESSING',
              senderWalletAddress: 'domain.com/bob',
              senderWalletAddressId: 'wallet-1',
              paymentIntentId,
              assetCode: 'USD',
              assetScale: 2,
              createdAt: new Date(),
              debitAmount: 500n,
              receiveAmount: 100n,
              sentAmount: 0n
            }
          ]
        };
        await repo.storeMany([paymentIntent]);

        const cmd = makeApprovePaymentCmd({
          id: paymentId,
          paymentIntentId
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCompleteFailedEvent.name);
        const payload = (events[0] as PaymentCompleteFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentInvalidStateError');
      });
    });

    describe('handlePrepareRemotePaymentCommand', () => {
      function makeRemoteIntentWithPayment(
        paymentIntentId: string,
        paymentId: string,
        paymentState: 'PROCESSING' | 'SENDING' | 'CREATED'
      ): IPaymentIntent {
        return {
          id: paymentIntentId,
          receivedAmount: 0n,
          receiverWalletAddress: 'remote.domain.com/alice',
          assetCode: 'USD',
          assetScale: 2,
          state: 'CREATED',
          destination: 'REMOTE',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          incomingAmount: null,
          destinationIlpAddress: 'g.peer.123',
          remoteUrl: 'https://remote.domain.com/incoming-payments/abc',
          quotes: [],
          inboundPayments: [],
          sentPayments: [
            {
              destination: 'REMOTE',
              peerId: 'peer-1',
              id: paymentId,
              state: paymentState,
              senderWalletAddress: 'domain.com/bob',
              senderWalletAddressId: 'wallet-1',
              paymentIntentId,
              assetCode: 'USD',
              assetScale: 2,
              createdAt: new Date(),
              debitAmount: 500n,
              receiveAmount: 100n,
              sentAmount: 0n
            }
          ]
        };
      }

      beforeEach(() => {
        mockRemotePaymentIntentService.setIncomingPaymentResponse(
          toIncomingPaymentWithMethods({
            walletAddress: 'remote.domain.com/alice',
            ilpAddress: 'g.peer.fresh-token',
            sharedSecret: 'fresh-per-prepare-secret'
          })
        );
      });

      it('transitions PROCESSING to SENDING, persists ledgerTransferId, and emits RemotePaymentPreparedEvent', async () => {
        const paymentIntentId = crypto.randomUUID();
        const paymentId = crypto.randomUUID();
        const paymentIntent = makeRemoteIntentWithPayment(
          paymentIntentId,
          paymentId,
          'PROCESSING'
        );
        await repo.storeMany([paymentIntent]);

        const palTransferId = 'ledger-pal-mint-123';
        const cmd = new PrepareRemotePaymentCmd(
          {
            paymentIntentId,
            paymentId,
            ledgerTransferId: palTransferId
          },
          crypto.randomUUID()
        );
        const { events } = await aggregate.handleBatch([cmd]);
        await aggregate.flush();

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, RemotePaymentPreparedEvent.name);
        const payload = (events[0] as RemotePaymentPreparedEvent).payload;
        assert.equal(payload.paymentIntentId, paymentIntentId);
        assert.equal(payload.paymentId, paymentId);
        assert.equal(payload.ledgerTransferId, palTransferId);
        // Pair destination + secret from the same OP fetch, not quote-time address.
        assert.equal(payload.destinationIlpAddress, 'g.peer.fresh-token');
        assert.notEqual(
          payload.destinationIlpAddress,
          paymentIntent.destinationIlpAddress
        );
        assert.equal(payload.debitAmount, '500');
        assert.equal(payload.receiveAmount, '100');
        assert.equal(payload.sharedSecret, 'fresh-per-prepare-secret');

        const storedPayment = repo
          .getAll()
          .find((i) => i.id === paymentIntentId)
          ?.sentPayments.find((p) => p.id === paymentId);
        assert.ok(storedPayment && isRemoteSentPayment(storedPayment));
        assert.equal(storedPayment.state, 'SENDING');
        assert.equal(storedPayment.ledgerTransferId, palTransferId);
      });

      it('fails to prepare if payment intent not found', async () => {
        const cmd = new PrepareRemotePaymentCmd(
          {
            paymentIntentId: crypto.randomUUID(),
            paymentId: crypto.randomUUID(),
            ledgerTransferId: 'ledger-1'
          },
          crypto.randomUUID()
        );
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCompleteFailedEvent.name);
        const payload = (events[0] as PaymentCompleteFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentIntentNotFoundError');
      });

      it('fails when payment state is not PROCESSING', async () => {
        const paymentIntentId = crypto.randomUUID();
        const paymentId = crypto.randomUUID();
        const paymentIntent = makeRemoteIntentWithPayment(
          paymentIntentId,
          paymentId,
          'SENDING'
        );
        await repo.storeMany([paymentIntent]);

        const cmd = new PrepareRemotePaymentCmd(
          {
            paymentIntentId,
            paymentId,
            ledgerTransferId: 'ledger-1'
          },
          crypto.randomUUID()
        );
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCompleteFailedEvent.name);
        const payload = (events[0] as PaymentCompleteFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentInvalidStateError');
      });
    });

    describe('handleFailRemotePaymentCommand', () => {
      function makeRemoteIntentWithPayment(
        paymentIntentId: string,
        paymentId: string,
        paymentState: 'PROCESSING' | 'FAILED' | 'CREATED'
      ): IPaymentIntent {
        return {
          id: paymentIntentId,
          receivedAmount: 0n,
          receiverWalletAddress: 'remote.domain.com/alice',
          assetCode: 'USD',
          assetScale: 2,
          state: 'CREATED',
          destination: 'REMOTE',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          incomingAmount: null,
          destinationIlpAddress: 'g.peer.123',
          quotes: [],
          inboundPayments: [],
          sentPayments: [
            {
              destination: 'REMOTE',
              peerId: 'peer-1',
              id: paymentId,
              state: paymentState,
              senderWalletAddress: 'domain.com/bob',
              senderWalletAddressId: 'wallet-1',
              paymentIntentId,
              assetCode: 'USD',
              assetScale: 2,
              createdAt: new Date(),
              debitAmount: 500n,
              receiveAmount: 100n,
              sentAmount: 0n
            }
          ]
        };
      }

      it('transitions PROCESSING to FAILED and emits PaymentFailedEvent', async () => {
        const paymentIntentId = crypto.randomUUID();
        const paymentId = crypto.randomUUID();
        const paymentIntent = makeRemoteIntentWithPayment(
          paymentIntentId,
          paymentId,
          'PROCESSING'
        );
        paymentIntent.sentPayments[0].grantId = 'grant-1';
        await repo.storeMany([paymentIntent]);

        const cmd = new FailRemotePaymentCmd(
          {
            paymentIntentId,
            paymentId,
            reason: 'Insufficient funds'
          },
          crypto.randomUUID()
        );
        const { events } = await aggregate.handleBatch([cmd]);
        await aggregate.flush();

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentFailedEvent.name);
        const payload = (events[0] as PaymentFailedEvent).payload;
        assert.equal(payload.id, paymentId);
        assert.equal(payload.paymentIntentId, paymentIntentId);
        assert.equal(payload.state, 'FAILED');
        assert.equal(payload.reason, 'Insufficient funds');
        assert.equal(payload.grantId, 'grant-1');

        const storedPayment = repo
          .getAll()
          .find((i) => i.id === paymentIntentId)
          ?.sentPayments.find((p) => p.id === paymentId);
        assert.ok(storedPayment && isRemoteSentPayment(storedPayment));
        assert.equal(storedPayment.state, 'FAILED');
        assert.equal(storedPayment.failReason, 'Insufficient funds');
      });

      it('fails when payment state is not PROCESSING', async () => {
        const paymentIntentId = crypto.randomUUID();
        const paymentId = crypto.randomUUID();
        const paymentIntent = makeRemoteIntentWithPayment(
          paymentIntentId,
          paymentId,
          'CREATED'
        );
        await repo.storeMany([paymentIntent]);

        const cmd = new FailRemotePaymentCmd(
          {
            paymentIntentId,
            paymentId,
            reason: 'nope'
          },
          crypto.randomUUID()
        );
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCompleteFailedEvent.name);
        const payload = (events[0] as PaymentCompleteFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentInvalidStateError');
      });
    });

    describe('handleConfirmRemotePaymentCommand', () => {
      function makeRemoteIntentWithPayment(
        paymentIntentId: string,
        paymentId: string,
        paymentState: 'SENDING' | 'CONFIRMED' | 'PROCESSING'
      ): IPaymentIntent {
        return {
          id: paymentIntentId,
          receivedAmount: 0n,
          receiverWalletAddress: 'remote.domain.com/alice',
          assetCode: 'USD',
          assetScale: 2,
          state: 'CREATED',
          destination: 'REMOTE',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          incomingAmount: null,
          destinationIlpAddress: 'g.peer.123',
          quotes: [],
          inboundPayments: [],
          sentPayments: [
            {
              destination: 'REMOTE',
              peerId: 'peer-1',
              id: paymentId,
              state: paymentState,
              senderWalletAddress: 'domain.com/bob',
              senderWalletAddressId: 'wallet-1',
              paymentIntentId,
              assetCode: 'USD',
              assetScale: 2,
              createdAt: new Date(),
              debitAmount: 500n,
              receiveAmount: 100n,
              sentAmount: 0n,
              ledgerTransferId: 'ledger-pal-1'
            }
          ]
        };
      }

      it('transitions SENDING to CONFIRMED and emits RemotePaymentSendConfirmedEvent', async () => {
        const paymentIntentId = crypto.randomUUID();
        const paymentId = crypto.randomUUID();
        await repo.storeMany([
          makeRemoteIntentWithPayment(paymentIntentId, paymentId, 'SENDING')
        ]);

        const cmd = new ConfirmRemotePaymentCmd(
          { paymentIntentId, paymentId },
          crypto.randomUUID()
        );
        const { events } = await aggregate.handleBatch([cmd]);
        await aggregate.flush();

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, RemotePaymentSendConfirmedEvent.name);
        const payload = (events[0] as RemotePaymentSendConfirmedEvent).payload;
        assert.equal(payload.paymentIntentId, paymentIntentId);
        assert.equal(payload.paymentId, paymentId);
        assert.equal(payload.ledgerTransferId, 'ledger-pal-1');

        const stored = repo
          .getAll()
          .find((i) => i.id === paymentIntentId)
          ?.sentPayments.find((p) => p.id === paymentId);
        assert.equal(stored?.state, 'CONFIRMED');
      });

      it('fails when payment state is not SENDING', async () => {
        const paymentIntentId = crypto.randomUUID();
        const paymentId = crypto.randomUUID();
        await repo.storeMany([
          makeRemoteIntentWithPayment(paymentIntentId, paymentId, 'PROCESSING')
        ]);

        const cmd = new ConfirmRemotePaymentCmd(
          { paymentIntentId, paymentId },
          crypto.randomUUID()
        );
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCompleteFailedEvent.name);
        const payload = (events[0] as PaymentCompleteFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentInvalidStateError');
      });

      it('fails without mutating when ledgerTransferId is missing after reload', async () => {
        const paymentIntentId = crypto.randomUUID();
        const paymentId = crypto.randomUUID();
        const intent = makeRemoteIntentWithPayment(
          paymentIntentId,
          paymentId,
          'SENDING'
        );
        const unprepared = intent.sentPayments[0];
        assert.ok(isRemoteSentPayment(unprepared));
        delete unprepared.ledgerTransferId;
        await repo.storeMany([intent]);

        const cmd = new ConfirmRemotePaymentCmd(
          { paymentIntentId, paymentId },
          crypto.randomUUID()
        );
        const { events } = await aggregate.handleBatch([cmd]);
        await aggregate.flush();

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCompleteFailedEvent.name);
        assert.match(
          (events[0] as PaymentCompleteFailedEvent).payload.message,
          /missing ledgerTransferId/
        );

        const stored = repo
          .getAll()
          .find((i) => i.id === paymentIntentId)
          ?.sentPayments.find((p) => p.id === paymentId);
        assert.equal(stored?.state, 'SENDING');
      });

      it('fails when payment intent not found', async () => {
        const cmd = new ConfirmRemotePaymentCmd(
          {
            paymentIntentId: crypto.randomUUID(),
            paymentId: crypto.randomUUID()
          },
          crypto.randomUUID()
        );
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCompleteFailedEvent.name);
        const payload = (events[0] as PaymentCompleteFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentIntentNotFoundError');
      });
    });

    describe('handleRejectRemotePaymentCommand', () => {
      function makeRemoteIntentWithPayment(
        paymentIntentId: string,
        paymentId: string,
        paymentState: 'SENDING' | 'REJECTED' | 'PROCESSING' | 'CONFIRMED'
      ): IPaymentIntent {
        return {
          id: paymentIntentId,
          receivedAmount: 0n,
          receiverWalletAddress: 'remote.domain.com/alice',
          assetCode: 'USD',
          assetScale: 2,
          state: 'CREATED',
          destination: 'REMOTE',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          incomingAmount: null,
          destinationIlpAddress: 'g.peer.123',
          quotes: [],
          inboundPayments: [],
          sentPayments: [
            {
              destination: 'REMOTE',
              peerId: 'peer-1',
              id: paymentId,
              state: paymentState,
              senderWalletAddress: 'domain.com/bob',
              senderWalletAddressId: 'wallet-1',
              paymentIntentId,
              assetCode: 'USD',
              assetScale: 2,
              createdAt: new Date(),
              debitAmount: 500n,
              receiveAmount: 100n,
              sentAmount: 0n,
              ledgerTransferId: 'ledger-pal-1'
            }
          ]
        };
      }

      it('transitions SENDING to REJECTED, persists failReason, and emits RemotePaymentSendRejectedEvent', async () => {
        const paymentIntentId = crypto.randomUUID();
        const paymentId = crypto.randomUUID();
        await repo.storeMany([
          makeRemoteIntentWithPayment(paymentIntentId, paymentId, 'SENDING')
        ]);

        const cmd = new RejectRemotePaymentCmd(
          { paymentIntentId, paymentId, reason: 'REJECTED' },
          crypto.randomUUID()
        );
        const { events } = await aggregate.handleBatch([cmd]);
        await aggregate.flush();

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, RemotePaymentSendRejectedEvent.name);
        const payload = (events[0] as RemotePaymentSendRejectedEvent).payload;
        assert.equal(payload.paymentIntentId, paymentIntentId);
        assert.equal(payload.paymentId, paymentId);
        assert.equal(payload.ledgerTransferId, 'ledger-pal-1');
        assert.equal(payload.reason, 'REJECTED');

        const stored = repo
          .getAll()
          .find((i) => i.id === paymentIntentId)
          ?.sentPayments.find((p) => p.id === paymentId);
        assert.ok(stored && isRemoteSentPayment(stored));
        assert.equal(stored.state, 'REJECTED');
        assert.equal(stored.failReason, 'REJECTED');
      });

      it('fails when payment state is not SENDING', async () => {
        const paymentIntentId = crypto.randomUUID();
        const paymentId = crypto.randomUUID();
        await repo.storeMany([
          makeRemoteIntentWithPayment(paymentIntentId, paymentId, 'CONFIRMED')
        ]);

        const cmd = new RejectRemotePaymentCmd(
          { paymentIntentId, paymentId, reason: 'REJECTED' },
          crypto.randomUUID()
        );
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCompleteFailedEvent.name);
        const payload = (events[0] as PaymentCompleteFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentInvalidStateError');
      });
    });

    describe('handleCompleteRemotePaymentCommand', () => {
      function makeRemoteIntentWithPayment(
        paymentIntentId: string,
        paymentId: string,
        paymentState: 'CONFIRMED' | 'SENDING' | 'PROCESSING',
        incomingAmount: bigint | null = null
      ): IPaymentIntent {
        return {
          id: paymentIntentId,
          receivedAmount: 0n,
          receiverWalletAddress: 'remote.domain.com/alice',
          assetCode: 'USD',
          assetScale: 2,
          state: 'CREATED',
          destination: 'REMOTE',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          incomingAmount,
          destinationIlpAddress: 'g.peer.123',
          quotes: [],
          inboundPayments: [],
          sentPayments: [
            {
              destination: 'REMOTE',
              peerId: 'peer-1',
              id: paymentId,
              state: paymentState,
              senderWalletAddress: 'domain.com/bob',
              senderWalletAddressId: 'wallet-1',
              paymentIntentId,
              assetCode: 'USD',
              assetScale: 2,
              createdAt: new Date(),
              debitAmount: 500n,
              receiveAmount: 100n,
              sentAmount: 0n,
              ledgerTransferId: 'ledger-pal-1'
            }
          ]
        };
      }

      it('transitions CONFIRMED to COMPLETED and emits PaymentCompletedEvent', async () => {
        const paymentIntentId = crypto.randomUUID();
        const paymentId = crypto.randomUUID();
        const paymentIntent = makeRemoteIntentWithPayment(
          paymentIntentId,
          paymentId,
          'CONFIRMED'
        );
        paymentIntent.sentPayments[0].grantId = 'grant-1';
        await repo.storeMany([paymentIntent]);

        const cmd = new CompleteRemotePaymentCmd(
          { paymentIntentId, paymentId },
          crypto.randomUUID()
        );
        const { events } = await aggregate.handleBatch([cmd]);
        await aggregate.flush();

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCompletedEvent.name);
        const payload = (events[0] as PaymentCompletedEvent).payload;
        assert.equal(payload.id, paymentId);
        assert.equal(payload.paymentIntentId, paymentIntentId);
        assert.equal(payload.state, 'COMPLETED');
        assert.equal(payload.sentAmount, '500');
        assert.equal(payload.grantId, 'grant-1');

        const stored = repo.getAll().find((i) => i.id === paymentIntentId);
        const storedPayment = stored?.sentPayments.find(
          (p) => p.id === paymentId
        );
        assert.equal(storedPayment?.state, 'COMPLETED');
        assert.equal(storedPayment?.sentAmount, 500n);
        assert.equal(stored?.receivedAmount, 100n);
      });

      it('does not emit PaymentIntentCompletedEvent when incomingAmount met on remote intent', async () => {
        const paymentIntentId = crypto.randomUUID();
        const paymentId = crypto.randomUUID();
        await repo.storeMany([
          makeRemoteIntentWithPayment(
            paymentIntentId,
            paymentId,
            'CONFIRMED',
            100n
          )
        ]);

        const cmd = new CompleteRemotePaymentCmd(
          { paymentIntentId, paymentId },
          crypto.randomUUID()
        );
        const { events } = await aggregate.handleBatch([cmd]);
        await aggregate.flush();

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCompletedEvent.name);

        const stored = repo.getAll().find((i) => i.id === paymentIntentId);
        assert.equal(stored?.state, 'CREATED');
        assert.equal(stored?.receivedAmount, 100n);
      });

      it('fails when payment state is not CONFIRMED', async () => {
        const paymentIntentId = crypto.randomUUID();
        const paymentId = crypto.randomUUID();
        await repo.storeMany([
          makeRemoteIntentWithPayment(paymentIntentId, paymentId, 'SENDING')
        ]);

        const cmd = new CompleteRemotePaymentCmd(
          { paymentIntentId, paymentId },
          crypto.randomUUID()
        );
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCompleteFailedEvent.name);
        const payload = (events[0] as PaymentCompleteFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentInvalidStateError');
      });
    });

    describe('handleFailRemotePaymentCommand from REJECTED source', () => {
      it('transitions REJECTED to FAILED and emits PaymentFailedEvent', async () => {
        const paymentIntentId = crypto.randomUUID();
        const paymentId = crypto.randomUUID();
        const paymentIntent: IPaymentIntent = {
          id: paymentIntentId,
          receivedAmount: 0n,
          receiverWalletAddress: 'remote.domain.com/alice',
          assetCode: 'USD',
          assetScale: 2,
          state: 'CREATED',
          destination: 'REMOTE',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          incomingAmount: null,
          destinationIlpAddress: 'g.peer.123',
          quotes: [],
          inboundPayments: [],
          sentPayments: [
            {
              destination: 'REMOTE',
              peerId: 'peer-1',
              id: paymentId,
              state: 'REJECTED',
              senderWalletAddress: 'domain.com/bob',
              senderWalletAddressId: 'wallet-1',
              paymentIntentId,
              assetCode: 'USD',
              assetScale: 2,
              createdAt: new Date(),
              debitAmount: 500n,
              receiveAmount: 100n,
              sentAmount: 0n,
              ledgerTransferId: 'ledger-pal-1',
              failReason: 'EXPIRED'
            }
          ]
        };
        await repo.storeMany([paymentIntent]);

        const cmd = new FailRemotePaymentCmd(
          {
            paymentIntentId,
            paymentId,
            reason: 'PAL voided reserved transfer'
          },
          crypto.randomUUID()
        );
        const { events } = await aggregate.handleBatch([cmd]);
        await aggregate.flush();

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentFailedEvent.name);
        const payload = (events[0] as PaymentFailedEvent).payload;
        assert.equal(payload.id, paymentId);
        assert.equal(payload.state, 'FAILED');
        assert.equal(payload.reason, 'PAL voided reserved transfer');

        const storedPayment = repo
          .getAll()
          .find((i) => i.id === paymentIntentId)
          ?.sentPayments.find((p) => p.id === paymentId);
        assert.ok(storedPayment && isRemoteSentPayment(storedPayment));
        assert.equal(storedPayment.state, 'FAILED');
        assert.equal(storedPayment.failReason, 'PAL voided reserved transfer');
      });
    });

    describe('handleCancelPaymentCommand', () => {
      function makeLocalIntentWithPayment(
        paymentIntentId: string,
        paymentId: string,
        paymentState: SentPaymentState
      ): IPaymentIntent {
        return {
          id: paymentIntentId,
          receivedAmount: 0n,
          receiverWalletAddress: 'receiver',
          receiverWalletAddressId: crypto.randomUUID(),
          assetCode: 'USD',
          assetScale: 2,
          state: 'CREATED',
          destination: 'LOCAL',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          incomingAmount: 100n,
          quotes: [],
          inboundPayments: [],
          sentPayments: [
            {
              destination: 'LOCAL',
              id: paymentId,
              state: paymentState,
              senderWalletAddress: 'sender',
              senderWalletAddressId: crypto.randomUUID(),
              assetCode: 'USD',
              paymentIntentId,
              assetScale: 2,
              createdAt: new Date(),
              debitAmount: 100n,
              receiveAmount: 100n,
              sentAmount: 0n
            }
          ]
        };
      }

      it('fails when payment intent not found', async () => {
        const cmd = makeCancelPaymentCmd({ paymentIntentId: 'nonexistent' });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCancelFailedEvent.name);
        const payload = (events[0] as PaymentCancelFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentIntentNotFoundError');
      });

      it('cancels a created payment', async () => {
        const paymentIntentId = crypto.randomUUID();
        const paymentId = crypto.randomUUID();
        const paymentIntent = makeLocalIntentWithPayment(
          paymentIntentId,
          paymentId,
          'CREATED'
        );
        paymentIntent.sentPayments[0].grantId = 'grant-1';
        await repo.storeMany([paymentIntent]);

        const cmd = makeCancelPaymentCmd({ id: paymentId, paymentIntentId });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCancelledEvent.name);
        const cancelled = (events[0] as PaymentCancelledEvent).payload;
        assert.equal(cancelled.id, paymentId);
        assert.equal(cancelled.grantId, 'grant-1');
      });

      it('fails when payment is already completed', async () => {
        const paymentIntentId = crypto.randomUUID();
        const paymentId = crypto.randomUUID();
        const paymentIntent = makeLocalIntentWithPayment(
          paymentIntentId,
          paymentId,
          'COMPLETED'
        );
        paymentIntent.sentPayments[0].grantId = 'grant-1';
        await repo.storeMany([paymentIntent]);

        const cmd = makeCancelPaymentCmd({ id: paymentId, paymentIntentId });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCancelFailedEvent.name);
        const payload = (events[0] as PaymentCancelFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentInvalidStateError');
        assert.equal(payload.grantId, 'grant-1');
      });

      it('persists the cancelled payment state after flush', async () => {
        const paymentIntentId = crypto.randomUUID();
        const paymentId = crypto.randomUUID();
        await repo.storeMany([
          makeLocalIntentWithPayment(paymentIntentId, paymentId, 'CREATED')
        ]);

        const beforeCancel = Date.now();
        const cmd = makeCancelPaymentCmd({
          id: paymentId,
          paymentIntentId,
          reason: 'user requested'
        });
        await aggregate.handleBatch([cmd]);
        await aggregate.flush();
        const afterCancel = Date.now();

        const storedPayment = repo
          .getAll()
          .find((intent) => intent.id === paymentIntentId)
          ?.sentPayments.find((p) => p.id === paymentId);
        assert.equal(storedPayment?.state, 'CANCELLED');
        assert.equal(storedPayment?.cancelReason, 'user requested');
        assert.ok(storedPayment?.cancelledAt);
        assert.ok(storedPayment.cancelledAt.getTime() >= beforeCancel);
        assert.ok(storedPayment.cancelledAt.getTime() <= afterCancel);
      });
    });

    describe('prefetch (peers & FX)', () => {
      function makeRemoteIntentWithIlp(ilpAddress: string): IPaymentIntent {
        return {
          id: crypto.randomUUID(),
          receivedAmount: 0n,
          receiverWalletAddress: 'remote.domain.com/alice',
          assetCode: 'USD',
          assetScale: 2,
          state: 'CREATED',
          destination: 'REMOTE',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          incomingAmount: null,
          quotes: [],
          sentPayments: [],
          inboundPayments: [],
          destinationIlpAddress: ilpAddress
        };
      }

      function makeCrossAssetPendingQuoteIntent(
        quoteId: string,
        amountOverride: { debitAmount: bigint } | { receiveAmount: bigint }
      ): IPaymentIntent {
        return {
          id: crypto.randomUUID(),
          receivedAmount: 0n,
          receiverWalletAddress: 'remote.domain.com/alice',
          assetCode: 'XRP',
          assetScale: 6,
          state: 'CREATED',
          destination: 'REMOTE',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          incomingAmount: null,
          quotes: [
            {
              id: quoteId,
              state: 'PENDING',
              senderWalletAddress: 'domain.com/bob',
              senderWalletAddressId: 'wallet-1',
              createdAt: new Date(),
              route: {
                peerId: 'peer-1',
                peerAssetCode: 'EUR',
                peerAssetScale: 2,
                sourceAmount: 100n,
                senderAssetCode: 'USD'
              },
              ...amountOverride
            }
          ],
          sentPayments: [],
          inboundPayments: [],
          destinationIlpAddress: 'g.peer.123'
        };
      }

      function makeCompleteRemoteQuoteCmd(
        overrides: Partial<{
          paymentIntentId: string;
          quoteId: string;
          receiveAmountValue: string;
        }> = {}
      ): CompleteRemoteQuoteCmd {
        return new CompleteRemoteQuoteCmd(
          {
            paymentIntentId: overrides.paymentIntentId ?? crypto.randomUUID(),
            quoteId: overrides.quoteId ?? crypto.randomUUID(),
            receiveAmountValue: overrides.receiveAmountValue ?? '10000'
          },
          crypto.randomUUID()
        );
      }

      it('peer dedup: two CreateQuoteCmds with same ILP address fetch peer once', async () => {
        const intentA = makeRemoteIntentWithIlp('g.peer.same');
        const intentB = makeRemoteIntentWithIlp('g.peer.same');
        await repo.storeMany([intentA, intentB]);

        let callCount = 0;
        mockPalService.getPeerByIlpAddress = async () => {
          callCount++;
          return { peerId: 'peer-1', assetCode: 'USD', assetScale: 2 };
        };

        const cmdA = makeCreateQuoteCmd({ paymentIntentId: intentA.id });
        const cmdB = makeCreateQuoteCmd({ paymentIntentId: intentB.id });
        const { events } = await aggregate.handleBatch([cmdA, cmdB]);

        assert.equal(callCount, 1);
        assert.equal(events.length, 2);
        assert.equal(events[0].msgName, RemoteQuoteRequestedEvent.name);
        assert.equal(events[1].msgName, RemoteQuoteRequestedEvent.name);
      });

      it('FX dedup: two CompleteRemoteQuoteCmds with same (peer, direction, asset) fetch rate once', async () => {
        const quoteIdA = crypto.randomUUID();
        const quoteIdB = crypto.randomUUID();
        const intentA = makeCrossAssetPendingQuoteIntent(quoteIdA, {
          debitAmount: 1000n
        });
        const intentB = makeCrossAssetPendingQuoteIntent(quoteIdB, {
          debitAmount: 2000n
        });
        await repo.storeMany([intentA, intentB]);

        let callCount = 0;
        mockPalService.getRates = async () => {
          callCount++;
          return 0.9;
        };

        const cmdA = makeCompleteRemoteQuoteCmd({
          paymentIntentId: intentA.id,
          quoteId: quoteIdA
        });
        const cmdB = makeCompleteRemoteQuoteCmd({
          paymentIntentId: intentB.id,
          quoteId: quoteIdB
        });
        const { events } = await aggregate.handleBatch([cmdA, cmdB]);

        assert.equal(callCount, 1);
        assert.equal(events.length, 2);
        assert.equal(events[0].msgName, QuoteCompletedEvent.name);
        assert.equal(events[1].msgName, QuoteCompletedEvent.name);
      });

      it('FX direction split: same peer/asset with debit and receive triggers two distinct fetches', async () => {
        const quoteIdA = crypto.randomUUID();
        const quoteIdB = crypto.randomUUID();
        const intentA = makeCrossAssetPendingQuoteIntent(quoteIdA, {
          debitAmount: 1000n
        });
        const intentB = makeCrossAssetPendingQuoteIntent(quoteIdB, {
          receiveAmount: 1000n
        });
        await repo.storeMany([intentA, intentB]);

        const calls: Array<Record<string, unknown>> = [];
        mockPalService.getRates = async (req) => {
          calls.push(req as unknown as Record<string, unknown>);
          return 0.9;
        };

        const cmdA = makeCompleteRemoteQuoteCmd({
          paymentIntentId: intentA.id,
          quoteId: quoteIdA
        });
        const cmdB = makeCompleteRemoteQuoteCmd({
          paymentIntentId: intentB.id,
          quoteId: quoteIdB
        });
        await aggregate.handleBatch([cmdA, cmdB]);

        assert.equal(calls.length, 2);
        assert.ok(
          calls.some(
            (c) => 'sourceAssetCode' in c && c.sourceAssetCode === 'USD'
          )
        );
        assert.ok(
          calls.some(
            (c) =>
              'destinationAssetCode' in c && c.destinationAssetCode === 'USD'
          )
        );
      });

      it('peer fetch error isolates to dependent command only', async () => {
        const intentA = makeRemoteIntentWithIlp('g.peer.fails.p1');
        const intentB = makeRemoteIntentWithIlp('g.peer.ok.p2');
        await repo.storeMany([intentA, intentB]);

        mockPalService.getPeerByIlpAddress = async (ilp) => {
          if (ilp === 'g.peer.fails') throw new Error('peer service down');
          return { peerId: 'peer-1', assetCode: 'USD', assetScale: 2 };
        };

        const cmdA = makeCreateQuoteCmd({ paymentIntentId: intentA.id });
        const cmdB = makeCreateQuoteCmd({ paymentIntentId: intentB.id });
        const { events } = await aggregate.handleBatch([cmdA, cmdB]);

        assert.equal(events.length, 2);
        assert.equal(events[0].msgName, QuoteCreateFailedEvent.name);
        const failed = (events[0] as QuoteCreateFailedEvent).payload;
        assert.equal(failed.errorName, 'Error');
        assert.equal(failed.message, 'peer service down');
        assert.equal(events[1].msgName, RemoteQuoteRequestedEvent.name);
      });

      it('FX fetch error isolates to dependent command only', async () => {
        const quoteIdA = crypto.randomUUID();
        const quoteIdB = crypto.randomUUID();
        const intentA = makeCrossAssetPendingQuoteIntent(quoteIdA, {
          debitAmount: 1000n
        });
        // intentB takes the same-asset path; doesn't go through FX prefetch
        const intentB = makeRemotePaymentIntentWithPendingQuote(quoteIdB);
        await repo.storeMany([intentA, intentB]);

        mockPalService.getRates = async () => {
          throw new Error('fx service down');
        };

        const cmdA = makeCompleteRemoteQuoteCmd({
          paymentIntentId: intentA.id,
          quoteId: quoteIdA
        });
        const cmdB = makeCompleteRemoteQuoteCmd({
          paymentIntentId: intentB.id,
          quoteId: quoteIdB
        });
        const { events } = await aggregate.handleBatch([cmdA, cmdB]);

        assert.equal(events.length, 2);
        assert.equal(events[0].msgName, QuoteCreateFailedEvent.name);
        const failed = (events[0] as QuoteCreateFailedEvent).payload;
        assert.equal(failed.errorName, 'Error');
        assert.equal(failed.message, 'fx service down');
        assert.equal(events[1].msgName, QuoteCompletedEvent.name);
      });

      it('null peer produces PeerNotFoundError', async () => {
        const intent = makeRemoteIntentWithIlp('g.peer.none');
        await repo.storeMany([intent]);

        mockPalService.getPeerByIlpAddress = async () => null;

        const cmd = makeCreateQuoteCmd({ paymentIntentId: intent.id });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, QuoteCreateFailedEvent.name);
        const payload = (events[0] as QuoteCreateFailedEvent).payload;
        assert.equal(payload.errorName, 'PeerNotFoundError');
      });

      it('null FX rate produces RatesError', async () => {
        const quoteId = crypto.randomUUID();
        const intent = makeCrossAssetPendingQuoteIntent(quoteId, {
          debitAmount: 1000n
        });
        await repo.storeMany([intent]);

        mockPalService.getRates = async () => null;

        const cmd = makeCompleteRemoteQuoteCmd({
          paymentIntentId: intent.id,
          quoteId
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, QuoteCreateFailedEvent.name);
        const payload = (events[0] as QuoteCreateFailedEvent).payload;
        assert.equal(payload.errorName, 'RatesError');
      });
    });
  });

  describe('flush', async () => {
    it('creates a payment intent', async () => {
      const paymentIntentId = crypto.randomUUID();
      const setupCmd = makeCreatePaymentIntentCmd({ id: paymentIntentId });
      await aggregate.handleBatch([setupCmd]);
      await aggregate.flush();

      const stored = repo.getAll();
      assert.equal(stored.length, 1);
      assert.equal(stored[0].id, paymentIntentId);
    });

    it('stores a remote payment intent created during quote', async () => {
      const REMOTE_URL = 'https://remote.domain.com/incoming-payments/abc';
      mockRemotePaymentIntentService.setIncomingPaymentResponse(
        toIncomingPaymentWithMethods({
          id: 'abc',
          walletAddress: 'remote.domain.com/alice',
          ilpAddress: 'g.peer.123',
          sharedSecret: 'stub-shared-secret'
        })
      );

      const cmd = makeCreateQuoteCmd({ remotePaymentIntentUrl: REMOTE_URL });
      await aggregate.handleBatch([cmd]);
      await aggregate.flush();

      const stored = repo.getAll();
      assert.equal(stored.length, 1);
      assert.equal(stored[0].id, cmd.payload.paymentIntentId);
      assert.equal(stored[0].destination, 'REMOTE');
      assert.equal(stored[0].remoteUrl, REMOTE_URL);
      assert.equal(stored[0].destinationIlpAddress, 'g.peer.123');
    });

    it('stores quotes for a payment intent', async () => {
      const paymentIntentId = crypto.randomUUID();
      const setupCmd = makeCreatePaymentIntentCmd({ id: paymentIntentId });
      await aggregate.handleBatch([setupCmd]);
      await aggregate.flush();

      const quoteId = crypto.randomUUID();
      const quoteCmd = makeCreateQuoteCmd({ id: quoteId, paymentIntentId });

      const { events } = await aggregate.handleBatch([quoteCmd]);
      assert.equal(events.length, 1);
      assert.equal(events[0].msgName, QuoteCompletedEvent.name);
      assert.equal(
        (events[0] as QuoteCompletedEvent).payload.paymentIntentId,
        paymentIntentId
      );

      await aggregate.flush();

      const stored = repo.getAll();
      assert.equal(stored.length, 1);
      assert.equal(stored[0].id, paymentIntentId);
      assert.equal(stored[0].quotes.length, 1);
      assert.equal(stored[0].quotes[0].id, quoteId);
    });
  });
});
