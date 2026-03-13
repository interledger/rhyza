import {
  CommandTopics,
  Message,
  MessageConsumer,
  MessageProducer
} from 'common-types-lib';
import {
  CreatePaymentIntentCmd,
  PaymentIntentAggregate
} from 'payments-domain-lib';

export class PaymentsCommandHandler {
  private _msgConsumer: MessageConsumer;
  private _msgProducer: MessageProducer;
  private _paymentIntentAggregate: PaymentIntentAggregate;

  constructor(
    msgConsumer: MessageConsumer,
    msgProducer: MessageProducer,
    paymentIntentAggregate: PaymentIntentAggregate
  ) {
    this._msgConsumer = msgConsumer;
    this._msgProducer = msgProducer;
    this._paymentIntentAggregate = paymentIntentAggregate;
  }

  async start(): Promise<void> {
    this._msgConsumer.setTopics([CommandTopics.PaymentCommands]);
    this._msgConsumer.setBatchCallbackFn(this._handleBatch.bind(this));
    await this._msgConsumer.connect();
    await this._msgConsumer.startAndWaitForRebalance();
  }

  async stop(): Promise<void> {
    await this._msgConsumer.stop();
    await this._msgConsumer.disconnect(true);
  }

  private async _handleBatch(messages: Message[]): Promise<void> {
    const incomingPaymentCmds: Message[] = [];
    // TODO: route quote and outgoing payment commands to their aggregates
    const unhandled: Message[] = [];

    for (const msg of messages) {
      switch (msg.msgName) {
        case CreatePaymentIntentCmd.name:
          incomingPaymentCmds.push(msg);
          break;
        default:
          unhandled.push(msg);
          break;
      }
    }

    if (unhandled.length > 0) {
      console.warn(
        `Unhandled command types: ${[...new Set(unhandled.map((m) => m.msgName))].join(', ')}`
      );
    }

    const eventsToPublish: Message[] = [];

    if (incomingPaymentCmds.length > 0) {
      const { events, updatedEntities } =
        await this._paymentIntentAggregate.handleBatch(incomingPaymentCmds);
      eventsToPublish.push(...events);

      await this._paymentIntentAggregate.flush(updatedEntities);
    }

    if (eventsToPublish.length > 0) {
      await this._msgProducer.send(eventsToPublish);
    }
  }
}
