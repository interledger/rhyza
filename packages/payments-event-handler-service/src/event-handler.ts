import {
  DomainEventTopics,
  IMessage,
  IMessageConsumer,
  IMessageProducer
} from 'common-types-lib';
import {
  CompleteRemoteQuoteCmd,
  FailRemoteQuoteCmd
} from 'payments-domain-lib';

// TODO: replace with event classes from ILP BC once they're defined
const ILP_QUOTE_DETERMINED_EVENT = 'QuoteDeterminedEvent';
const ILP_QUOTE_FAILED_EVENT = 'QuoteFailedEvent';

// TODO: finalize payload shapes with ILP BC
interface IlpQuoteDeterminedPayload {
  paymentIntentId: string;
  quoteId: string;
  maxSourceAmount: number;
  minDeliveryAmount: number;
  lowEstimatedExchangeRate: number;
}

interface IlpQuoteFailedPayload {
  paymentIntentId: string;
  quoteId: string;
  errorName: string;
  message: string;
}

export class PaymentsEventHandler {
  private _msgConsumer: IMessageConsumer;
  private _msgProducer: IMessageProducer;

  constructor(msgConsumer: IMessageConsumer, msgProducer: IMessageProducer) {
    this._msgConsumer = msgConsumer;
    this._msgProducer = msgProducer;
  }

  async start(): Promise<void> {
    this._msgConsumer.setTopics([DomainEventTopics.IlpEvents]);
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
      case ILP_QUOTE_DETERMINED_EVENT: {
        const payload = message.payload as IlpQuoteDeterminedPayload;
        const cmd = new CompleteRemoteQuoteCmd(
          {
            quoteId: payload.quoteId,
            paymentIntentId: payload.paymentIntentId,
            maxSourceAmount: payload.maxSourceAmount,
            minDeliveryAmount: payload.minDeliveryAmount,
            lowEstimatedExchangeRate: payload.lowEstimatedExchangeRate
          },
          message.requestId ?? ''
        );
        await this._msgProducer.send(cmd);
        break;
      }
      case ILP_QUOTE_FAILED_EVENT: {
        const payload = message.payload as IlpQuoteFailedPayload;
        const cmd = new FailRemoteQuoteCmd(
          {
            quoteId: payload.quoteId,
            paymentIntentId: payload.paymentIntentId,
            errorName: payload.errorName,
            message: payload.message
          },
          message.requestId ?? ''
        );
        await this._msgProducer.send(cmd);
        break;
      }
      default:
        console.warn(`Unhandled ILP event — msgName: ${message.msgName}`);
    }
  }
}
