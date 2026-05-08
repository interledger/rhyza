import {
  ILogger,
  IMessageProducer,
  IMessageConsumer,
  IMessage,
  DomainEventTopics,
  DomainEvent
} from 'common-types-lib';

export class IntegrationEventHandler {
  private readonly _logger: ILogger;
  private readonly _msgConsumer: IMessageConsumer;
  private readonly _msgProducer: IMessageProducer;
  private readonly _pendingMessages: IMessage[] = [];
  private readonly _internalEventTopics: string[] = [];

  constructor(
    messageConsumer: IMessageConsumer,
    msgProducer: IMessageProducer,
    logger: ILogger
  ) {
    this._logger = logger;
    this._msgConsumer = messageConsumer;
    this._msgProducer = msgProducer;

    this._internalEventTopics.push(
      ...[
        DomainEventTopics.PeerEvents,
        DomainEventTopics.AssetEvents,
        DomainEventTopics.WalletAddressEvents,
        DomainEventTopics.LedgerEvents
      ]
    );
  }

  private async _handleIntegrationMessages(messages: IMessage[]) {
    this._logger.info(`Received ${messages.length} messages`);

    for (const msg of messages) {
      if (this._internalEventTopics.includes(msg.msgTopic)) {
        await this._handleInternalBcEvents(msg as DomainEvent);
      } else {
        await this._handleExternalEvents(msg as DomainEvent);
      }
    }

    if (this._pendingMessages.length > 0) {
      await this._msgProducer.send(this._pendingMessages);
      this._logger.debug(
        `Published ${this._pendingMessages.length} pending messages at the end of the batch`
      );
      this._pendingMessages.length = 0;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async _handleInternalBcEvents(evt: DomainEvent): Promise<void> {
    // nothing yet
  }

  private async _handleExternalEvents(evt: DomainEvent): Promise<void> {
    // TODO use correct event class names from the payments public types lib
    //  (right now they are in the payments domain lib)

    // if(msg.msgName === "PaymentIntentCreatedEvent") {
    if (evt.msgName === 'RemotePaymentApprovedEvent') {
      // create a CheckBalanceAndReserveTransferCmd
    } else if (evt.msgName === 'PaymentCreatedEvent') {
      // create a CommitTransferCmd
    } else if (evt.msgName === 'PaymentCreateFailedEvent') {
      // create a RejectTransferCmd
    }
    // NOTE: we shouldn't log ignored events, they can be the majority
  }

  async init(): Promise<void> {
    this._msgConsumer.setTopics([
      DomainEventTopics.PaymentEvents,
      DomainEventTopics.AssetEvents
    ]);
    this._msgConsumer.setBatchCallbackFn(
      this._handleIntegrationMessages.bind(this)
    );
    await this._msgConsumer.connect();
    await this._msgConsumer.startAndWaitForRebalance();

    this._logger.info(`${this.constructor.name} initialized`);
  }

  async destroy(): Promise<void> {
    await this._msgConsumer.stop();
    return;
  }
}
