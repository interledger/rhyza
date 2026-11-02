import { DomainEvent, DomainEventTopics } from 'common-types-lib';
import { PeerHttpConfig } from './interfaces';

const BOUNDED_CONTEXT_NAME = 'ilp';
const AGGREGATE_NAME = 'ilp-peer';

export interface ILPPeerCreatedPayload {
  peerId: string;
  http: PeerHttpConfig;
  isActive?: boolean;
}

export class ILPPeerCreatedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgTopic: string = DomainEventTopics.IlpEvents;
  payload: ILPPeerCreatedPayload;

  constructor(payload: ILPPeerCreatedPayload, requestId?: string) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
    this.requestId = requestId;
  }
}

export interface ILPPeerCreationFailedPayload {
  peerId: string;
  errorName: string;
  message: string;
}

export class ILPPeerCreationFailedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgTopic: string = DomainEventTopics.IlpEvents;
  isErrorEvent: boolean = true;
  payload: ILPPeerCreationFailedPayload;

  constructor(payload: ILPPeerCreationFailedPayload, requestId?: string) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
    this.requestId = requestId;
  }
}

export interface ILPPeerUpdatedPayload {
  peerId: string;
  http: PeerHttpConfig;
  isActive?: boolean;
}

export class ILPPeerUpdatedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgTopic: string = DomainEventTopics.IlpEvents;
  payload: ILPPeerUpdatedPayload;

  constructor(payload: ILPPeerUpdatedPayload, requestId?: string) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
    this.requestId = requestId;
  }
}

export interface ILPPeerUpdateFailedPayload {
  peerId: string;
  errorName: string;
  message: string;
}

export class ILPPeerUpdateFailedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgTopic: string = DomainEventTopics.IlpEvents;
  isErrorEvent: boolean = true;
  payload: ILPPeerUpdateFailedPayload;

  constructor(payload: ILPPeerUpdateFailedPayload, requestId?: string) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
    this.requestId = requestId;
  }
}

export interface ILPQuoteReceivedPayload {
  peerId: string;
  paymentIntentId: string;
  quoteId: string;
  destinationAmount: string;
}

export class ILPQuoteReceivedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgTopic: string = DomainEventTopics.IlpEvents;
  payload: ILPQuoteReceivedPayload;

  constructor(payload: ILPQuoteReceivedPayload, requestId?: string) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
    this.requestId = requestId;
  }
}

export interface ILPQuoteFailedPayload {
  peerId: string;
  paymentIntentId: string;
  quoteId: string;
  rejectCode?: string;
  rejectMessage?: string;
  expired?: boolean;
}

export class ILPQuoteFailedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgTopic: string = DomainEventTopics.IlpEvents;
  isErrorEvent: boolean = true;
  payload: ILPQuoteFailedPayload;

  constructor(payload: ILPQuoteFailedPayload, requestId?: string) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
    this.requestId = requestId;
  }
}

export interface ILPQuoteRequestReceivedPayload {
  peerId: string;
  packetId: string;
  paymentIntentId: string;
  incomingAmount: string;
  expiresAt: string;
}

export class ILPQuoteRequestReceivedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgTopic: string = DomainEventTopics.IlpEvents;
  payload: ILPQuoteRequestReceivedPayload;

  constructor(payload: ILPQuoteRequestReceivedPayload) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
  }
}

export interface ILPPaymentConfirmedPayload {
  peerId: string;
  paymentIntentId: string;
  paymentId: string;
  confirmedAt: string;
  // Receiver-credited amount from STREAM fulfill `prepareAmount`, when present.
  destinationAmount?: string;
  destinationAssetCode?: string;
  destinationAssetScale?: number;
}

export class ILPPaymentConfirmedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgTopic: string = DomainEventTopics.IlpEvents;
  payload: ILPPaymentConfirmedPayload;

  constructor(payload: ILPPaymentConfirmedPayload, requestId?: string) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
    this.requestId = requestId;
  }
}

export const ILPPaymentFailureReason = {
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED'
} as const;
export type ILPPaymentFailureReason = keyof typeof ILPPaymentFailureReason;

export interface ILPPaymentFailedPayload {
  peerId: string;
  paymentIntentId: string;
  paymentId: string;
  failedAt: string;
  reason: ILPPaymentFailureReason;
  rejectCode?: string;
  rejectMessage?: string;
}

export class ILPPaymentFailedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgTopic: string = DomainEventTopics.IlpEvents;
  isErrorEvent: boolean = true;
  payload: ILPPaymentFailedPayload;

  constructor(payload: ILPPaymentFailedPayload, requestId?: string) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
    this.requestId = requestId;
  }
}

// Inbound prepare verified as a real STREAM payment (awaiting Payments finalization).
export interface ILPPaymentReceivedPayload {
  peerId: string;
  packetId: string;
  paymentIntentId: string;
  paymentId: string;
  sourceAmount: string;
  requestId: string;
  expiresAt: string;
}

export class ILPPaymentReceivedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgTopic: string = DomainEventTopics.IlpEvents;
  payload: ILPPaymentReceivedPayload;

  constructor(payload: ILPPaymentReceivedPayload) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
    this.requestId = payload.requestId;
  }
}

// Fulfillment successfully dispatched back to the source peer.
export interface ILPPaymentFulfillmentSentPayload {
  peerId: string;
  packetId: string;
  paymentIntentId: string;
  paymentId: string;
  inboundPaymentId: string;
  fulfilledAt: string;
  requestId: string;
}

export class ILPPaymentFulfillmentSentEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgTopic: string = DomainEventTopics.IlpEvents;
  payload: ILPPaymentFulfillmentSentPayload;

  constructor(payload: ILPPaymentFulfillmentSentPayload) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
    this.requestId = payload.requestId;
  }
}

// Could not return fulfillment (expired, missing correlation, dispatch failure).
export interface ILPPaymentFulfillmentFailedPayload {
  peerId: string;
  packetId: string;
  paymentIntentId: string;
  paymentId: string;
  inboundPaymentId: string;
  failedAt: string;
  reason: string;
  requestId: string;
}

export class ILPPaymentFulfillmentFailedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgTopic: string = DomainEventTopics.IlpEvents;
  isErrorEvent: boolean = true;
  payload: ILPPaymentFulfillmentFailedPayload;

  constructor(payload: ILPPaymentFulfillmentFailedPayload) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
    this.requestId = payload.requestId;
  }
}
