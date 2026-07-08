import { DomainEvent, DomainEventTopics } from 'common-types-lib';

const BOUNDED_CONTEXT_NAME = 'ilp';
const AGGREGATE_NAME = 'ilp-peer';

export interface RemoteQuoteReceivedPayload {
  peerId: string;
  paymentIntentId: string;
  quoteId: string;
  destinationAmount: string;
}

export class RemoteQuoteReceivedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgTopic: string = DomainEventTopics.IlpEvents;
  payload: RemoteQuoteReceivedPayload;

  constructor(payload: RemoteQuoteReceivedPayload) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
  }
}

export interface QuoteFailedPayload {
  peerId: string;
  paymentIntentId: string;
  quoteId: string;
  rejectCode?: string;
  rejectMessage?: string;
  expired?: boolean;
}

export class QuoteFailedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgTopic: string = DomainEventTopics.IlpEvents;
  isErrorEvent: boolean = true;
  payload: QuoteFailedPayload;

  constructor(payload: QuoteFailedPayload) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
  }
}

export interface RemotePaymentConfirmedPayload {
  peerId: string;
  paymentIntentId: string;
  paymentId: string;
  confirmedAt: string;
}

export class RemotePaymentConfirmedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgTopic: string = DomainEventTopics.IlpEvents;
  payload: RemotePaymentConfirmedPayload;

  constructor(payload: RemotePaymentConfirmedPayload) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
  }
}

export const RemotePaymentFailureReason = {
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED'
} as const;
export type RemotePaymentFailureReason =
  keyof typeof RemotePaymentFailureReason;

export interface RemotePaymentFailedPayload {
  peerId: string;
  paymentIntentId: string;
  paymentId: string;
  failedAt: string;
  reason: RemotePaymentFailureReason;
}

export class RemotePaymentFailedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgTopic: string = DomainEventTopics.IlpEvents;
  isErrorEvent: boolean = true;
  payload: RemotePaymentFailedPayload;

  constructor(payload: RemotePaymentFailedPayload) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
  }
}
