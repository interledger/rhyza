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

  static isLocalPaymentCompletedEvent(
    evt: DomainEvent
  ): evt is LocalPaymentCompletedEvent {
    return evt.msgName === LocalPaymentCompletedEvent.name;
  }

  static isLocalPaymentCompleteFailedEvent(
    evt: DomainEvent
  ): evt is LocalPaymentCompleteFailedEvent {
    return evt.msgName === LocalPaymentCompleteFailedEvent.name;
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

export type LocalPaymentCompletedPayload = {
  id: string;
};

export class LocalPaymentCompletedEvent extends PaymentIntentDomainEvent {
  payload: LocalPaymentCompletedPayload;

  constructor(payload: LocalPaymentCompletedPayload, requestId?: string) {
    super(payload.id);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type LocalPaymentCompleteFailedPayload = {
  paymentIntentId: string;
  errorName: string;
  message: string;
};

export class LocalPaymentCompleteFailedEvent extends PaymentIntentDomainEvent {
  payload: LocalPaymentCompleteFailedPayload;
  isErrorEvent = true;

  constructor(payload: LocalPaymentCompleteFailedPayload, requestId?: string) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type RemoteQuoteRequestedPayload = {
  paymentIntentId: string;
  quoteId: string;
  senderWalletAddress: string;
  receiverWalletAddress: string;
  senderAssetCode: string;
  senderAssetScale: number;
  receiverAssetCode: string;
  receiverAssetScale: number;
  debitAmount?: string;
  receiveAmount?: string;
  destinationIlpAddress: string;
};

export class RemoteQuoteRequestedEvent extends PaymentIntentDomainEvent {
  payload: RemoteQuoteRequestedPayload;

  constructor(payload: RemoteQuoteRequestedPayload, requestId?: string) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}
