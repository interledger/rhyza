import { CommandMsg, CommandTopics } from 'common-types-lib';

const BOUNDED_CONTEXT_NAME = 'payment';
const PAYMENT_INTENT_AGG_NAME = 'payment-intents';

export interface CreatePaymentIntentCmdPayload {
  id: string;
  receiverWalletAddressId: string;
  receiverWalletAddress: string;
  expiresAt?: string;
  incomingAmount?: number;
  metadata?: string;
}

export class CreatePaymentIntentCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateId: string;
  aggregateName: string = PAYMENT_INTENT_AGG_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.PaymentCommands;
  payload: CreatePaymentIntentCmdPayload;

  constructor(payload: CreatePaymentIntentCmdPayload, requestId: string) {
    super();
    this.aggregateId = this.msgKey = payload.id;
    this.requestId = requestId;
    this.payload = payload;
  }
}
