import { DomainEvent, DomainEventTopics } from 'common-types-lib';
import { PaymentIntentState, PaymentState } from './interfaces';

export abstract class PaymentIntentDomainEvent extends DomainEvent {
  msgTopic: string = DomainEventTopics.PaymentEvents;
  isErrorEvent = false;

  protected constructor(aggId: string) {
    super(aggId);
    this.msgKey = aggId;
  }

  static isPaymentIntentCreatedEvent(
    evt: DomainEvent
  ): evt is PaymentIntentCreatedEvent {
    return evt.msgName === PaymentIntentCreatedEvent.name;
  }

  static isPaymentIntentCreateFailedEvent(
    evt: DomainEvent
  ): evt is PaymentIntentCreateFailedEvent {
    return evt.msgName === PaymentIntentCreateFailedEvent.name;
  }

  static isQuoteCompletedEvent(evt: DomainEvent): evt is QuoteCompletedEvent {
    return evt.msgName === QuoteCompletedEvent.name;
  }

  static isQuoteCreateFailedEvent(
    evt: DomainEvent
  ): evt is QuoteCreateFailedEvent {
    return evt.msgName === QuoteCreateFailedEvent.name;
  }

  static isPaymentCreatedEvent(evt: DomainEvent): evt is PaymentCreatedEvent {
    return evt.msgName === PaymentCreatedEvent.name;
  }

  static isPaymentCreateFailedEvent(
    evt: DomainEvent
  ): evt is PaymentCreateFailedEvent {
    return evt.msgName === PaymentCreateFailedEvent.name;
  }

  static isPaymentCompletedEvent(
    evt: DomainEvent
  ): evt is PaymentCompletedEvent {
    return evt.msgName === PaymentCompletedEvent.name;
  }

  static isPaymentCompleteFailedEvent(
    evt: DomainEvent
  ): evt is PaymentCompleteFailedEvent {
    return evt.msgName === PaymentCompleteFailedEvent.name;
  }

  static isPaymentCancelledEvent(
    evt: DomainEvent
  ): evt is PaymentCancelledEvent {
    return evt.msgName === PaymentCancelledEvent.name;
  }

  static isPaymentCancelFailedEvent(
    evt: DomainEvent
  ): evt is PaymentCancelFailedEvent {
    return evt.msgName === PaymentCancelFailedEvent.name;
  }

  static isRemoteQuoteRequestedEvent(
    evt: DomainEvent
  ): evt is RemoteQuoteRequestedEvent {
    return evt.msgName === RemoteQuoteRequestedEvent.name;
  }
}

export type PaymentIntentCreatedPayload = {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  incomingAmount: string | null;
  receivedAmount: string | null;
  state: PaymentIntentState;
  receiverWalletAddressId?: string;
  assetCode: string;
  assetScale: number;
};

export class PaymentIntentCreatedEvent extends PaymentIntentDomainEvent {
  payload: PaymentIntentCreatedPayload;

  constructor(payload: PaymentIntentCreatedPayload, requestId?: string) {
    super(payload.id);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type PaymentIntentCreateFailedPayload = {
  paymentIntentId: string;
  errorName: string;
  message: string;
};

export class PaymentIntentCreateFailedEvent extends PaymentIntentDomainEvent {
  payload: PaymentIntentCreateFailedPayload;
  isErrorEvent = true;

  constructor(payload: PaymentIntentCreateFailedPayload, requestId?: string) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type PaymentIntentCompletedPayload = {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  incomingAmount: string | null;
  receivedAmount: string | null;
  state: PaymentIntentState;
  receiverWalletAddressId?: string;
  assetCode: string;
  assetScale: number;
};

export class PaymentIntentCompletedEvent extends PaymentIntentDomainEvent {
  payload: PaymentIntentCompletedPayload;

  constructor(payload: PaymentIntentCompletedPayload, requestId?: string) {
    super(payload.id);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type QuoteCompletedPayload = {
  id: string;
  paymentIntentId: string;
  senderWalletAddress: string;
  senderWalletAddressId: string;
  expiresAt: string;
  debitAmount: string;
  receiveAmount: string;
  exchangeRate: number;
};

export class QuoteCompletedEvent extends PaymentIntentDomainEvent {
  payload: QuoteCompletedPayload;

  constructor(payload: QuoteCompletedPayload, requestId?: string) {
    super(payload.id);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type QuoteCreateFailedPayload = {
  paymentIntentId: string;
  errorName: string;
  message: string;
};

export class QuoteCreateFailedEvent extends PaymentIntentDomainEvent {
  payload: QuoteCreateFailedPayload;
  isErrorEvent = true;

  constructor(payload: QuoteCreateFailedPayload, requestId?: string) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type PaymentCreatedPayload = {
  id: string;
  paymentIntentId: string;
  senderWalletAddress: string;
  debitAmount: string | null;
  receiveAmount: string | null;
  sentAmount: string | null;
  state: PaymentState;
  createdAt: Date;
  assetCode: string;
  assetScale: number;
  receiveAssetScale: number;
  receiveAssetCode: string;
};

export class PaymentCreatedEvent extends PaymentIntentDomainEvent {
  payload: PaymentCreatedPayload;

  constructor(payload: PaymentCreatedPayload, requestId?: string) {
    super(payload.id);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type PaymentCreateFailedPayload = {
  paymentIntentId: string;
  errorName: string;
  message: string;
};

export class PaymentCreateFailedEvent extends PaymentIntentDomainEvent {
  payload: PaymentCreateFailedPayload;
  isErrorEvent = true;

  constructor(payload: PaymentCreateFailedPayload, requestId?: string) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type PaymentCompletedPayload = {
  id: string;
  paymentIntentId: string;
  senderWalletAddress: string;
  debitAmount: string | null;
  receiveAmount: string | null;
  sentAmount: string | null;
  state: PaymentState;
  createdAt: Date;
  assetCode: string;
  assetScale: number;
  receiveAssetScale: number;
  receiveAssetCode: string;
};

export class PaymentCompletedEvent extends PaymentIntentDomainEvent {
  payload: PaymentCompletedPayload;

  constructor(payload: PaymentCompletedPayload, requestId?: string) {
    super(payload.id);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type PaymentCompleteFailedPayload = {
  id: string;
  paymentIntentId: string;
  errorName: string;
  message: string;
};

export class PaymentCompleteFailedEvent extends PaymentIntentDomainEvent {
  payload: PaymentCompleteFailedPayload;
  isErrorEvent = true;

  constructor(payload: PaymentCompleteFailedPayload, requestId?: string) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type PaymentCancelledPayload = {
  id: string;
};

export class PaymentCancelledEvent extends PaymentIntentDomainEvent {
  payload: PaymentCancelledPayload;

  constructor(payload: PaymentCancelledPayload, requestId?: string) {
    super(payload.id);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type PaymentCancelFailedPayload = {
  paymentIntentId: string;
  errorName: string;
  message: string;
};

export class PaymentCancelFailedEvent extends PaymentIntentDomainEvent {
  payload: PaymentCancelFailedPayload;
  isErrorEvent = true;

  constructor(payload: PaymentCancelFailedPayload, requestId?: string) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

// TODO: audit payload fields for removal candidates:
//   - senderWalletAddress/receiverWalletAddress and asset code/scale: not sure if ILP BC needs these or just peer
export type RemoteQuoteRequestedPayload = {
  paymentIntentId: string;
  quoteId: string;
  requestId: string;
  senderWalletAddress: string;
  receiverWalletAddress: string;
  senderAssetCode: string;
  senderAssetScale: number;
  receiverAssetCode: string;
  receiverAssetScale: number;
  peerId: string;
  peerAssetCode: string;
  peerAssetScale: number;
  sourceAmount: string;
};

export class RemoteQuoteRequestedEvent extends PaymentIntentDomainEvent {
  payload: RemoteQuoteRequestedPayload;

  constructor(payload: RemoteQuoteRequestedPayload, requestId?: string) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}
