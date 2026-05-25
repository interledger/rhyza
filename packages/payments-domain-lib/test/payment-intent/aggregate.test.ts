import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ConsoleLogger } from 'common-types-lib';

import { PaymentIntentAggregate } from '../../src/payment-intent/aggregate';
import {
  PaymentCreatedEvent,
  PaymentCreateFailedEvent,
  PaymentIntentCreatedEvent,
  PaymentIntentCreateFailedEvent
} from '../../src/payment-intent/events';
import {
  CompleteRemoteQuoteCmd,
  CreatePaymentCmd,
  CreatePaymentIntentCmd,
  FailRemoteQuoteCmd
} from '../../src/commands';
import {
  MockPaymentIntentRepo,
  MockWalletAddressAdapter,
  MockRatesAdapter,
  MockRemotePaymentIntentService
} from '../mocks';
import { QuoteCreateFailedEvent } from '../../src/payment-intent/events';
import { CreateQuoteCmd } from '../../src/commands';
import { QuoteCompletedEvent } from '../../src/payment-intent/events';
import { IPaymentIntent } from '../../src/payment-intent/interfaces';
import { ApprovePaymentCmd } from '../../src/commands';
import {
  LocalPaymentCompletedEvent,
  LocalPaymentCompleteFailedEvent,
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
  let walletAddressAdapter: MockWalletAddressAdapter;
  let mockRatesAdapter: MockRatesAdapter;
  let mockRemotePaymentIntentService: MockRemotePaymentIntentService;
  let aggregate: PaymentIntentAggregate;

  beforeEach(() => {
    repo = new MockPaymentIntentRepo();
    walletAddressAdapter = new MockWalletAddressAdapter();
    walletAddressAdapter.addWalletAddress({
      id: 'wallet-1',
      isActive: true,
      assetCode: 'USD',
      assetScale: 2
    });
    mockRatesAdapter = new MockRatesAdapter();
    mockRemotePaymentIntentService = new MockRemotePaymentIntentService();
    aggregate = new PaymentIntentAggregate(
      repo,
      walletAddressAdapter,
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
          senderWalletAddressId: 'wallet-1'
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
        walletAddressAdapter.addWalletAddress({
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
        walletAddressAdapter.addWalletAddress({
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
        assert.equal(payload.destinationIlpAddress, 'g.peer.123');
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
        assert.equal(payload.debitAmount, '500');
        assert.equal(payload.receiveAmount, undefined);
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
          maxSourceAmount: number;
          minDeliveryAmount: number;
          lowEstimatedExchangeRate: number;
        }> = {}
      ): CompleteRemoteQuoteCmd {
        return new CompleteRemoteQuoteCmd(
          {
            paymentIntentId: overrides.paymentIntentId ?? crypto.randomUUID(),
            quoteId: overrides.quoteId ?? crypto.randomUUID(),
            maxSourceAmount: overrides.maxSourceAmount ?? 500,
            minDeliveryAmount: overrides.minDeliveryAmount ?? 450,
            lowEstimatedExchangeRate: overrides.lowEstimatedExchangeRate ?? 0.9
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

      it('emits QuoteCreateFailedEvent with ILP error details on success', async () => {
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
        assert.equal(payload.destinationIlpAddress, 'g.peer.123');
        assert.equal(payload.debitAmount, '500');
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
        walletAddressAdapter.addWalletAddress({
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
        assert.equal(events[0].msgName, LocalPaymentCompleteFailedEvent.name);
        const payload = (events[0] as LocalPaymentCompleteFailedEvent).payload;
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
        assert.equal(events[0].msgName, LocalPaymentCompletedEvent.name);
        assert.equal(
          (events[0] as LocalPaymentCompletedEvent).payload.id,
          paymentId
        );
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
