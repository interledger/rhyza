import { RevertGrantSpentAmountCmd } from 'auth-domain-lib';
import {
  IMessage,
  IMessageConsumer,
  IMessageProducer,
  ILogger,
  DomainEventTopics
} from 'common-types-lib';
import {
    PaymentCreateFailedEvent,
  PaymentFailedEvent
} from 'payments-public-types-lib'

export class AuthEventHandler {
  private _msgConsumer: IMessageConsumer;
  private _msgProducer: IMessageProducer;
  private _logger: ILogger;

  constructor(
    msgConsumer: IMessageConsumer,
    msgProducer: IMessageProducer,
    logger: ILogger
  ) {
    this._msgConsumer = msgConsumer;
    this._msgProducer = msgProducer;
    this._logger = logger;
  }

  async start(): Promise<void> {
    // TODO: subscribe to the relevant event topics once handling is implemented.
    this._msgConsumer.setTopics([
      DomainEventTopics.PaymentEvents
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
      case PaymentCreateFailedEvent.name: {
        const payload = message.payload as PaymentCreateFailedEvent['payload'];
        // if (!payload.grantId || (!payload.debitAmountValue && !payload.receiveAmountValue)) return; // Replace with better error? 
        if (!payload.grantId) return
        const cmd = new RevertGrantSpentAmountCmd({
          id: payload.grantId,
          debitAmountValue: payload.debitAmountValue ? String(payload.debitAmountValue) : undefined,
          receiveAmountValue: payload.receiveAmountValue ? String(payload.receiveAmountValue) : undefined,
          createdAt: payload.createdAt
        }, crypto.randomUUID())
        await this._msgProducer.send(cmd);
        break;
      }
      case PaymentFailedEvent.name: {
        const payload = message.payload as PaymentFailedEvent['payload'];
        if (!payload.grantId) return;
        const cmd = new RevertGrantSpentAmountCmd({
          id: payload.grantId,
          debitAmountValue: payload.debitAmount ?? undefined,
          receiveAmountValue: payload.receiveAmount ?? undefined,
          createdAt: payload.createdAt.toISOString()
        }, crypto.randomUUID());
        await this._msgProducer.send(cmd);
        break;
      }
      default:
        this._logger.warn(`Unhandled event — msgName: ${message.msgName}`);
    }
  }
}
