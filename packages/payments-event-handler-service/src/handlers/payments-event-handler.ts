import {
  DomainEventTopics,
  IMessage,
  IMessageConsumer,
  IMessageProducer,
  TimerEventTopics
} from 'common-types-lib';
import {
  CompleteRemoteQuoteCmd,
  FailRemoteQuoteCmd,
  PrepareRemotePaymentCmd,
  FailRemotePaymentCmd,
  ConfirmRemotePaymentCmd,
  RejectRemotePaymentCmd,
  CompleteRemotePaymentCmd,
  ValidateInboundPaymentCmd,
  AcceptInboundPaymentCmd,
  FailInboundPaymentCmd,
  MarkInboundPaymentFulfillableCmd,
  FinalizeInboundPaymentCmd,
  CalculateRemoteQuoteCmd,
  ExpirePaymentIntentCmd,
  ExpirePaymentCmd
} from 'payments-domain-lib';
import {
  ILPPaymentConfirmedEvent,
  ILPPaymentFailedEvent,
  ILPPaymentFulfillmentFailedEvent,
  ILPPaymentFulfillmentSentEvent,
  ILPPaymentReceivedEvent,
  ILPQuoteFailedEvent,
  ILPQuoteReceivedEvent,
  ILPQuoteRequestReceivedEvent
} from 'ilp-domain-lib';
import {
  LedgerOutgoingTransferReservedEvent,
  LedgerOutgoingTransferInsufficientFundsErrorEvent,
  LedgerOutgoingTransferCommittedEvent,
  LedgerOutgoingTransferRejectedEvent,
  LedgerIncomingTransferReservedEvent,
  LedgerIncomingTransferInsufficientFundsErrorEvent,
  LedgerIncomingTransferRejectedEvent,
  LedgerIncomingTransferCommittedEvent,
  LedgerOutgoingTransferCheckBalanceAndReserveFailedEvent,
  LedgerOutgoingTransferCommitFailedEvent,
  LedgerOutgoingTransferRejectFailedEvent,
  LedgerIncomingTransferReserveFailedEvent,
  LedgerIncomingTransferCommitFailedEvent,
  LedgerHighLevelSuccessResponseEventPayload,
  LedgerHighLevelFailureResponseEventPayload
} from 'pal-public-types-lib';
import { MongoDbPaymentIntentRepo } from 'payments-implementations-lib';
import { CheckExpirationEvent } from 'payments-public-types-lib';

export class PaymentsEventHandler {
  private _msgConsumer: IMessageConsumer;
  private _msgProducer: IMessageProducer;
  private _repo: MongoDbPaymentIntentRepo;
  private readonly instanceId: string;

  constructor(
    msgConsumer: IMessageConsumer,
    msgProducer: IMessageProducer,
    repo: MongoDbPaymentIntentRepo,
    instanceId: string
  ) {
    this._msgConsumer = msgConsumer;
    this._msgProducer = msgProducer;
    this._repo = repo;
    this.instanceId = instanceId;
  }

  async start(): Promise<void> {
    this._msgConsumer.setTopics([
      DomainEventTopics.IlpEvents,
      DomainEventTopics.LedgerEvents,
      TimerEventTopics.PaymentExpiredTimeEvents
    ]);
    this._msgConsumer.setBatchCallbackFn(async (messages: IMessage[]) => {
      for (const message of messages) {
        await this._handleEvent(message);
      }
    });
    await this._msgConsumer.connect();
    await this._msgConsumer.startAndWaitForRebalance();
  }

  async stop(): Promise<void> {
    await this._msgConsumer.stop();
    await this._msgConsumer.disconnect(true);
  }

  private async _handleEvent(message: IMessage): Promise<void> {
    switch (message.msgName) {
      case ILPQuoteReceivedEvent.name: {
        const { quoteId, paymentIntentId, destinationAmount } =
          message.payload as ILPQuoteReceivedEvent['payload'];
        const cmd = new CompleteRemoteQuoteCmd(
          {
            quoteId,
            paymentIntentId,
            receiveAmountValue: destinationAmount
          },
          // TODO: requestId required - remove fallback when provided by ILP
          message.requestId ?? ''
        );
        await this._msgProducer.send(cmd);
        break;
      }
      case ILPQuoteFailedEvent.name: {
        const payload = message.payload as ILPQuoteFailedEvent['payload'];
        const cmd = new FailRemoteQuoteCmd(
          {
            quoteId: payload.quoteId,
            paymentIntentId: payload.paymentIntentId,
            errorName: payload.rejectCode ?? 'QuoteFailed',
            message:
              payload.rejectMessage ??
              (payload.expired
                ? 'Quote expired'
                : 'Quote could not be determined')
          },
          // TODO: requestId required - remove fallback when provided by ILP
          message.requestId ?? ''
        );
        await this._msgProducer.send(cmd);
        break;
      }
      case ILPQuoteRequestReceivedEvent.name: {
        const payload =
          message.payload as ILPQuoteRequestReceivedEvent['payload'];
        const cmd = new CalculateRemoteQuoteCmd(
          {
            packetId: payload.packetId,
            peerId: payload.peerId,
            paymentIntentId: payload.paymentIntentId,
            sourceAmount: payload.incomingAmount
          },
          crypto.randomUUID()
        );
        await this._msgProducer.send(cmd);
        break;
      }
      case ILPPaymentReceivedEvent.name: {
        const payload = message.payload as ILPPaymentReceivedEvent['payload'];
        const cmd = new ValidateInboundPaymentCmd(
          {
            id: crypto.randomUUID(),
            paymentIntentId: payload.paymentIntentId,
            packetId: payload.packetId,
            peerId: payload.peerId,
            sourceAmount: payload.sourceAmount,
            expiresAt: payload.expiresAt
          },
          payload.requestId
        );
        await this._msgProducer.send(cmd);
        break;
      }
      case LedgerIncomingTransferReservedEvent.name: {
        // TODO: auto-accepting. Design calls for marking pending-acceptance,
        // webhooking the ASE via Notifications, and the ASE accepting through
        // the admin API.
        const payload =
          message.payload as LedgerHighLevelSuccessResponseEventPayload;
        const cmd = new AcceptInboundPaymentCmd(
          {
            inboundPaymentId: payload.paymentId,
            paymentIntentId: payload.paymentIntentId,
            ledgerTransferId: payload.transferId
          },
          payload.requestId
        );
        await this._msgProducer.send(cmd);
        break;
      }
      case LedgerIncomingTransferCommittedEvent.name: {
        const payload =
          message.payload as LedgerHighLevelSuccessResponseEventPayload;
        const cmd = new MarkInboundPaymentFulfillableCmd(
          {
            inboundPaymentId: payload.paymentId,
            paymentIntentId: payload.paymentIntentId
          },
          payload.requestId
        );
        await this._msgProducer.send(cmd);
        break;
      }
      case ILPPaymentFulfillmentSentEvent.name: {
        const payload =
          message.payload as ILPPaymentFulfillmentSentEvent['payload'];
        const cmd = new FinalizeInboundPaymentCmd(
          {
            inboundPaymentId: payload.inboundPaymentId,
            paymentIntentId: payload.paymentIntentId
          },
          payload.requestId
        );
        await this._msgProducer.send(cmd);
        break;
      }
      case ILPPaymentFulfillmentFailedEvent.name: {
        const payload =
          message.payload as ILPPaymentFulfillmentFailedEvent['payload'];
        const cmd = new FailInboundPaymentCmd(
          {
            inboundPaymentId: payload.inboundPaymentId,
            paymentIntentId: payload.paymentIntentId,
            reason: payload.reason ?? 'ILP fulfillment failed'
          },
          payload.requestId
        );
        await this._msgProducer.send(cmd);
        break;
      }
      case LedgerIncomingTransferInsufficientFundsErrorEvent.name:
      case LedgerIncomingTransferRejectedEvent.name: {
        const payload =
          message.payload as LedgerHighLevelFailureResponseEventPayload;
        const cmd = new FailInboundPaymentCmd(
          {
            inboundPaymentId: payload.paymentId,
            paymentIntentId: payload.paymentIntentId,
            reason: payload.errorMessage ?? 'Ledger transfer failed'
          },
          payload.requestId
        );
        await this._msgProducer.send(cmd);
        break;
      }
      case LedgerIncomingTransferReserveFailedEvent.name: {
        const payload =
          message.payload as LedgerIncomingTransferReserveFailedEvent['payload'];
        const cmd = new FailInboundPaymentCmd(
          {
            inboundPaymentId: payload.paymentId,
            paymentIntentId: payload.paymentIntentId,
            reason: payload.errorMessage
          },
          payload.requestId
        );
        await this._msgProducer.send(cmd);
        break;
      }
      case LedgerIncomingTransferCommitFailedEvent.name: {
        const payload =
          message.payload as LedgerHighLevelFailureResponseEventPayload;
        const cmd = new FailInboundPaymentCmd(
          {
            inboundPaymentId: payload.paymentId,
            paymentIntentId: payload.paymentIntentId,
            reason: payload.errorMessage ?? 'Ledger commit failed'
          },
          payload.requestId
        );
        await this._msgProducer.send(cmd);
        break;
      }
      case LedgerOutgoingTransferReservedEvent.name: {
        const payload =
          message.payload as LedgerHighLevelSuccessResponseEventPayload;
        const cmd = new PrepareRemotePaymentCmd(
          {
            paymentIntentId: payload.paymentIntentId,
            paymentId: payload.paymentId,
            ledgerTransferId: payload.transferId
          },
          payload.requestId
        );
        await this._msgProducer.send(cmd);
        break;
      }
      case LedgerOutgoingTransferInsufficientFundsErrorEvent.name: {
        const payload =
          message.payload as LedgerHighLevelFailureResponseEventPayload;
        const cmd = new FailRemotePaymentCmd(
          {
            paymentIntentId: payload.paymentIntentId,
            paymentId: payload.paymentId,
            reason: payload.errorMessage ?? 'Insufficient funds'
          },
          payload.requestId
        );
        await this._msgProducer.send(cmd);
        break;
      }
      case LedgerOutgoingTransferCheckBalanceAndReserveFailedEvent.name: {
        const payload =
          message.payload as LedgerOutgoingTransferCheckBalanceAndReserveFailedEvent['payload'];
        const cmd = new FailRemotePaymentCmd(
          {
            paymentIntentId: payload.paymentIntentId,
            paymentId: payload.paymentId,
            reason: payload.errorMessage
          },
          payload.requestId
        );
        await this._msgProducer.send(cmd);
        break;
      }
      case ILPPaymentConfirmedEvent.name: {
        const payload = message.payload as ILPPaymentConfirmedEvent['payload'];
        const cmd = new ConfirmRemotePaymentCmd(
          {
            paymentIntentId: payload.paymentIntentId,
            paymentId: payload.paymentId
          },
          message.requestId ?? ''
        );
        await this._msgProducer.send(cmd);
        break;
      }
      case ILPPaymentFailedEvent.name: {
        const payload = message.payload as ILPPaymentFailedEvent['payload'];
        const cmd = new RejectRemotePaymentCmd(
          {
            paymentIntentId: payload.paymentIntentId,
            paymentId: payload.paymentId,
            reason: payload.reason,
            rejectCode: payload.rejectCode,
            rejectMessage: payload.rejectMessage
          },
          message.requestId ?? ''
        );
        await this._msgProducer.send(cmd);
        break;
      }
      case LedgerOutgoingTransferCommittedEvent.name: {
        const payload =
          message.payload as LedgerHighLevelSuccessResponseEventPayload;
        const cmd = new CompleteRemotePaymentCmd(
          {
            paymentIntentId: payload.paymentIntentId,
            paymentId: payload.paymentId
          },
          payload.requestId
        );
        await this._msgProducer.send(cmd);
        break;
      }
      case LedgerOutgoingTransferRejectedEvent.name: {
        const payload =
          message.payload as LedgerHighLevelSuccessResponseEventPayload;
        const cmd = new FailRemotePaymentCmd(
          {
            paymentIntentId: payload.paymentIntentId,
            paymentId: payload.paymentId
          },
          payload.requestId
        );
        await this._msgProducer.send(cmd);
        break;
      }
      case LedgerOutgoingTransferCommitFailedEvent.name:
      case LedgerOutgoingTransferRejectFailedEvent.name: {
        // TODO: placeholder — commit/reject failed mid-flight; needs reconciliation.
        break;
      }
      case CheckExpirationEvent.name: {
        await this._checkExpirations(message.requestId ?? '');
        break;
      }
      default:
        console.warn(`Unhandled event — msgName: ${message.msgName}`);
    }
  }

  private async _checkExpirations(requestId: string): Promise<void> {
    const paymentIntentIds = await this._repo.getExpiredPaymentIntentIds(20);
    const paymentIds = await this._repo.getExpiredPayments(20);
    if (paymentIntentIds.length === 0 && paymentIds.length === 0) {
      return;
    }
    const messages: IMessage[] = [];
    paymentIntentIds.forEach((paymentIntentId: string) =>
      messages.push(new ExpirePaymentIntentCmd({ paymentIntentId }, requestId))
    );
    paymentIds.forEach((payment) =>
      messages.push(new ExpirePaymentCmd(payment, requestId))
    );
    await this._msgProducer.send(messages);
  }
}
