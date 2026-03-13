import { DomainEventMsg, EventTopics } from 'common-types-lib';

const BOUNDED_CONTEXT_NAME = 'payment';
const AGGREGATE_NAME = 'payment-intents';

export interface PaymentIntentCreatedPayload {
  id: string;
}

export class PaymentIntentCreatedEvent extends DomainEventMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateId: string;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = EventTopics.PaymentEvents;
  payload: PaymentIntentCreatedPayload;

  constructor(payload: PaymentIntentCreatedPayload, requestId?: string) {
    super();
    this.aggregateId = this.msgKey = payload.id;
    this.payload = payload;
    this.requestId = requestId;
  }
}

export interface PaymentIntentCreateFailedPayload {
  errorName: string;
  message: string;
}

export class PaymentIntentCreateFailedEvent extends DomainEventMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateId: string;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = EventTopics.PaymentEvents;
  isErrorEvent: boolean = true;
  payload: PaymentIntentCreateFailedPayload;

  constructor(payload: PaymentIntentCreateFailedPayload, requestId?: string) {
    super();
    this.aggregateId = this.msgKey = requestId ?? '';
    this.payload = payload;
    this.requestId = requestId;
  }
}
