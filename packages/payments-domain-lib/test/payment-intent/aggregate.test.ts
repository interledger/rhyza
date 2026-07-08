import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ConsoleLogger } from 'common-types-lib';

import { PaymentIntentAggregate } from '../../src/payment-intent/aggregate';
import {
  PaymentCompletedEvent,
  PaymentCompleteFailedEvent,
  PaymentCreatedEvent,
  PaymentCreateFailedEvent,
  PaymentIntentCreatedEvent,
  PaymentIntentCreateFailedEvent
} from '../../src/payment-intent/events';
import {
  CompleteRemoteQuoteCmd,
  CreatePaymentCmd,
  CreatePaymentIntentCmd,
  CancelPaymentCmd,
  FailRemoteQuoteCmd
} from '../../src/commands';
import {
  MockPaymentIntentRepo,
  MockRatesAdapter,
  MockRemotePaymentIntentService,
  MockPalService
} from '../mocks';
import {
  QuoteCreateFailedEvent,
  QuoteCompletedEvent
} from '../../src/payment-intent/events';
import { CreateQuoteCmd } from '../../src/commands';
import {
  IPaymentIntent,
  PaymentState
} from '../../src/payment-intent/interfaces';
import { ApprovePaymentCmd } from '../../src/commands';
import {
  PaymentCancelledEvent,
  PaymentCancelFailedEvent,
  RemoteQuoteRequestedEvent
} from '../../src/payment-intent/events';

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

function makeCreateQuoteCmd(
  overrides: Partial<{
    id: string;
    paymentIntentId: string;
    senderWalletAddressId: string;
    senderWalletAddress: string;
    debitAmount: number;
    receiveAmount: number;
    remoteUrl: string;
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
    debitAmount: number;
    quoteId: string;
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
  let mockRatesAdapter: MockRatesAdapter;
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
    mockRatesAdapter = new MockRatesAdapter();
    mockRemotePaymentIntentService = new MockRemotePaymentIntentService();
    aggregate = new PaymentIntentAggregate(
      repo,
      mockPalService,
      mockRatesAdapter,
      mockRemotePaymentIntentService,
      new ConsoleLogger()
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
          peerId: 'peer-1',
          peerAssetCode: 'USD',
          peerAssetScale: 2,
          sourceAmount: 100n,
          senderAssetCode: 'USD',
          debitAmount: 500n
        }
      ],
      payments: [],
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
        assert.equal(
          (events[0] as PaymentIntentCreatedEvent).payload.id,
          cmd.payload.id
        );
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
          assetCode: 'USD',
          assetScale: 2,
          state: 'CREATED',
          destination: 'LOCAL',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 1000),
          incomingAmount: null,
          quotes: [],
          payments: []
        };
        await repo.storeMany([paymentIntent]);

        mockRatesAdapter.getRate = async () => undefined;

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
          payments: []
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
          payments: [],
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
          payments: []
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
                peerId: 'peer-1',
                peerAssetCode: 'EUR',
                peerAssetScale: 2,
                sourceAmount: 100n,
                senderAssetCode: 'USD',
                ...amountOverride
              }
            ],
            payments: [],
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

    describe('handleCreateQuoteCommand (remote url)', () => {
      const REMOTE_URL = 'https://remote.domain.com/incoming-payments/abc';

      beforeEach(() => {
        mockRemotePaymentIntentService.fetchIncomingPayment = async () => ({
          walletAddress: 'remote.domain.com/alice',
          assetCode: 'USD',
          assetScale: 2,
          receivedAmount: 0n,
          destinationIlpAddress: 'g.peer.123',
          expiresAt: new Date(Date.now() + 60_000).toISOString()
        });
      });

      it('fetches remote intent and emits RemoteQuoteRequestedEvent', async () => {
        const cmd = makeCreateQuoteCmd({
          remoteUrl: REMOTE_URL,
          debitAmount: 500
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, RemoteQuoteRequestedEvent.name);
        const payload = (events[0] as RemoteQuoteRequestedEvent).payload;
        assert.equal(payload.paymentIntentId, cmd.payload.paymentIntentId);
        assert.equal(payload.quoteId, cmd.payload.id);
        assert.equal(payload.peerId, 'peer-1');
      });

      it('deduplicates intra-batch: second cmd with same url uses first intent id', async () => {
        let fetchCount = 0;
        const originalFetch =
          mockRemotePaymentIntentService.fetchIncomingPayment.bind(
            mockRemotePaymentIntentService
          );
        mockRemotePaymentIntentService.fetchIncomingPayment = async (url) => {
          fetchCount++;
          return originalFetch(url);
        };

        const cmd1 = makeCreateQuoteCmd({
          remoteUrl: REMOTE_URL,
          debitAmount: 100
        });
        const cmd2 = makeCreateQuoteCmd({
          remoteUrl: REMOTE_URL,
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
          payments: [],
          destinationIlpAddress: 'g.peer.123',
          remoteUrl: REMOTE_URL
        };
        await repo.storeMany([existingPaymentIntent]);

        const cmd = makeCreateQuoteCmd({
          remoteUrl: REMOTE_URL,
          debitAmount: 300
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, RemoteQuoteRequestedEvent.name);
        const payload = (events[0] as RemoteQuoteRequestedEvent).payload;
        assert.equal(payload.paymentIntentId, existingPaymentIntent.id);
      });

      it('emits QuoteCreateFailedEvent when remote fetch throws', async () => {
        mockRemotePaymentIntentService.fetchIncomingPayment = async () => {
          throw new Error('Connection refused');
        };

        const cmd = makeCreateQuoteCmd({ remoteUrl: REMOTE_URL });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, QuoteCreateFailedEvent.name);
        const payload = (events[0] as QuoteCreateFailedEvent).payload;
        assert.equal(payload.paymentIntentId, cmd.payload.paymentIntentId);
        assert.match(payload.message, /Connection refused/);
      });
    });

    describe('handleCreatePaymentCommand', () => {
      it('fails when sender wallet address not found', async () => {
        const quoteCmd = makeCreatePaymentCmd({
          senderWalletAddressId: 'nonexistent'
        });
        const { events } = await aggregate.handleBatch([quoteCmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCreateFailedEvent.name);
        const payload = (events[0] as PaymentCreateFailedEvent).payload;
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
          assetCode: 'USD',
          assetScale: 2,
          state: 'CREATED',
          destination: 'LOCAL',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 1000),
          incomingAmount: null,
          quotes: [],
          payments: []
        };
        await repo.storeMany([paymentIntent]);

        mockRatesAdapter.getRate = async () => undefined;

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
          payments: []
        };
        await repo.storeMany([paymentIntent]);

        const cmd = makeCreatePaymentCmd({
          paymentIntentId: paymentIntent.id
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCreatedEvent.name);
        assert.equal(
          (events[0] as PaymentCreatedEvent).payload.id,
          cmd.payload.id
        );
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
          payments: [
            {
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
              sentAmount: 0n
            }
          ]
        };
        await repo.storeMany([paymentIntent]);

        const cmd = makeApprovePaymentCmd({
          id: paymentId,
          paymentIntentId: paymentIntentId
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCompletedEvent.name);
        assert.equal(
          (events[0] as PaymentCompletedEvent).payload.id,
          paymentId
        );
      });
    });

    describe('handleCancelPaymentCommand', () => {
      function makeLocalIntentWithPayment(
        paymentIntentId: string,
        paymentId: string,
        paymentState: PaymentState
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
          payments: [
            {
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
        await repo.storeMany([
          makeLocalIntentWithPayment(paymentIntentId, paymentId, 'CREATED')
        ]);

        const cmd = makeCancelPaymentCmd({ id: paymentId, paymentIntentId });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCancelledEvent.name);
        assert.equal(
          (events[0] as PaymentCancelledEvent).payload.id,
          paymentId
        );
      });

      it('fails when payment is already completed', async () => {
        const paymentIntentId = crypto.randomUUID();
        const paymentId = crypto.randomUUID();
        await repo.storeMany([
          makeLocalIntentWithPayment(paymentIntentId, paymentId, 'COMPLETED')
        ]);

        const cmd = makeCancelPaymentCmd({ id: paymentId, paymentIntentId });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, PaymentCancelFailedEvent.name);
        const payload = (events[0] as PaymentCancelFailedEvent).payload;
        assert.equal(payload.errorName, 'PaymentInvalidStateError');
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
          ?.payments.find((p) => p.id === paymentId);
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
          payments: [],
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
              peerId: 'peer-1',
              peerAssetCode: 'EUR',
              peerAssetScale: 2,
              sourceAmount: 100n,
              senderAssetCode: 'USD',
              ...amountOverride
            }
          ],
          payments: [],
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
        const intentA = makeRemoteIntentWithIlp('g.peer.fails');
        const intentB = makeRemoteIntentWithIlp('g.peer.ok');
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
      mockRemotePaymentIntentService.fetchIncomingPayment = async () => ({
        walletAddress: 'remote.domain.com/alice',
        assetCode: 'USD',
        assetScale: 2,
        receivedAmount: 0n,
        destinationIlpAddress: 'g.peer.123',
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      });

      const cmd = makeCreateQuoteCmd({ remoteUrl: REMOTE_URL });
      await aggregate.handleBatch([cmd]);
      await aggregate.flush();

      const stored = repo.getAll();
      assert.equal(stored.length, 1);
      assert.equal(stored[0].id, cmd.payload.paymentIntentId);
      assert.equal(stored[0].destination, 'REMOTE');
      assert.equal(stored[0].remoteUrl, REMOTE_URL);
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
