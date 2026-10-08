import {
  ILogger,
  IMessageProducer,
  IMessageConsumer,
  IMessage,
  DomainEventTopics,
  DomainEvent,
  MessageTypes
} from 'common-types-lib';
import {
  InboundPaymentValidatedEvent,
  InboundPaymentFailedEvent,
  RemotePaymentSendApprovedEvent,
  RemotePaymentSendConfirmedEvent,
  RemotePaymentSendRejectedEvent,
  InboundPaymentAcceptedEvent
} from 'payments-public-types-lib';
import {
  CheckBalanceAndReserveTransferCmd,
  ReserveTransferCmd,
  CommitTransferCmd,
  RejectTransferCmd
} from 'pal-domain-lib';

/**
 * External event handler for processing integration events from other bounded contexts
 */
export class IntegrationEventHandler {
  private readonly _logger: ILogger;
  private readonly _msgConsumer: IMessageConsumer;
  private readonly _msgProducer: IMessageProducer;
  private readonly _pendingMessages: IMessage[] = [];

  constructor(
    messageConsumer: IMessageConsumer,
    msgProducer: IMessageProducer,
    logger: ILogger
  ) {
    this._logger = logger.child(this.constructor.name);
    this._msgConsumer = messageConsumer;
    this._msgProducer = msgProducer;
  }

  private async _handleMessageBatch(messages: IMessage[]) {
    this._logger.debug(`Received batch of ${messages.length} messages`);
    // NOTE: we shouldn't log ignored events, they can be the majority

    for (const msg of messages) {
      if (msg.msgType !== MessageTypes.DOMAIN_EVENT) {
        continue;
      }

      await this._handleEvent(msg as DomainEvent);
    }

    if (this._pendingMessages.length > 0) {
      await this._msgProducer.send(this._pendingMessages);
      this._logger.debug(
        `Published ${this._pendingMessages.length} pending messages at the end of the batch`
      );
      this._pendingMessages.length = 0;
    }
  }

  private async _handleEvent(evt: DomainEvent): Promise<void> {
    // if(msg.msgName === "PaymentIntentCreatedEvent") {
    if (evt.msgName === RemotePaymentSendApprovedEvent.name) {
      await this._handleRemotePaymentSendApproved(evt);
    } else if (evt.msgName === RemotePaymentSendConfirmedEvent.name) {
      await this._handleRemotePaymentSendConfirmed(evt);
    } else if (evt.msgName === RemotePaymentSendRejectedEvent.name) {
      await this._handleRemotePaymentSendRejected(evt);
    } else if (evt.msgName === InboundPaymentValidatedEvent.name) {
      await this._handleInboundPaymentValidated(evt);
    } else if (evt.msgName === InboundPaymentAcceptedEvent.name) {
      await this._handleInboundPaymentAccepted(evt);
    } else if (evt.msgName === InboundPaymentFailedEvent.name) {
      // RejectTransferCmd (INCOMING)
    }
  }

  private async _handleRemotePaymentSendApproved(
    evt: RemotePaymentSendApprovedEvent
  ): Promise<void> {
    const cmd = new CheckBalanceAndReserveTransferCmd(evt.payload.assetCode, {
      requestId: evt.payload.requestId,
      transferId: evt.payload.transferId ?? crypto.randomUUID(),
      peerId: evt.payload.peerId,
      amount: evt.payload.debitAmount,
      amountScale: evt.payload.assetScale,
      transferDirection: 'OUTGOING',
      paymentIntentId: evt.payload.paymentIntentId,
      paymentId: evt.payload.paymentId
    });

    this._pendingMessages.push(cmd);
  }

  private async _handleRemotePaymentSendConfirmed(
    evt: RemotePaymentSendConfirmedEvent
  ): Promise<void> {
    this._pendingMessages.push(
      new CommitTransferCmd(evt.payload.assetCode, {
        requestId: evt.payload.requestId,
        transferId: evt.payload.ledgerTransferId,
        transferDirection: 'OUTGOING',
        paymentIntentId: evt.payload.paymentIntentId,
        paymentId: evt.payload.paymentId
      })
    );
  }

  private async _handleRemotePaymentSendRejected(
    evt: RemotePaymentSendRejectedEvent
  ): Promise<void> {
    this._pendingMessages.push(
      new RejectTransferCmd(evt.payload.assetCode, {
        requestId: evt.payload.requestId,
        transferId: evt.payload.ledgerTransferId,
        transferDirection: 'OUTGOING',
        paymentIntentId: evt.payload.paymentIntentId,
        paymentId: evt.payload.paymentId
      })
    );
  }

  private async _handleInboundPaymentValidated(
    evt: InboundPaymentValidatedEvent
  ): Promise<void> {
    this._pendingMessages.push(
      new ReserveTransferCmd(evt.payload.receiveAssetCode, {
        requestId: evt.payload.requestId,
        transferId: crypto.randomUUID(),
        peerId: evt.payload.peerId,
        amount: evt.payload.receiveAmount,
        amountScale: evt.payload.receiveAssetScale,
        transferDirection: 'INCOMING',
        paymentIntentId: evt.payload.paymentIntentId,
        paymentId: evt.payload.inboundPaymentId
      })
    );
  }

  private async _handleInboundPaymentAccepted(
    evt: InboundPaymentAcceptedEvent
  ): Promise<void> {
    this._pendingMessages.push(
      new CommitTransferCmd(evt.payload.receiveAssetCode, {
        requestId: evt.payload.requestId,
        transferId: evt.payload.ledgerTransferId,
        transferDirection: 'INCOMING',
        paymentIntentId: evt.payload.paymentIntentId,
        paymentId: evt.payload.inboundPaymentId
      })
    );
  }

  async init(): Promise<void> {
    this._msgConsumer.setTopics([DomainEventTopics.PaymentEvents]);
    this._msgConsumer.setBatchCallbackFn(this._handleMessageBatch.bind(this));
    await this._msgConsumer.connect();
    await this._msgConsumer.startAndWaitForRebalance();

    this._logger.info(`${this.constructor.name} initialized`);
  }

  async destroy(): Promise<void> {
    await this._msgConsumer.stop();
    return;
  }
}
