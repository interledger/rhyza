import {
  AppErrorType,
  DomainEvent,
  DomainEventTopics,
  TimerEvent,
  TimerEventTopics
} from 'common-types-lib';
import {
  PaymentIntentState,
  SentPaymentState,
  InboundPaymentState
} from '../types/payment-intent';

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

  static isPaymentIntentCompletedEvent(
    evt: DomainEvent
  ): evt is PaymentIntentCompletedEvent {
    return evt.msgName === PaymentIntentCompletedEvent.name;
  }

  static isPaymentIntentCompleteFailedEvent(
    evt: DomainEvent
  ): evt is PaymentIntentCompleteFailedEvent {
    return evt.msgName === PaymentIntentCompleteFailedEvent.name;
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

  static isRemoteQuoteCalculatedEvent(
    evt: DomainEvent
  ): evt is RemoteQuoteCalculatedEvent {
    return evt.msgName === RemoteQuoteCalculatedEvent.name;
  }

  static isRemoteQuoteCalculationFailedEvent(
    evt: DomainEvent
  ): evt is RemoteQuoteCalculationFailedEvent {
    return evt.msgName === RemoteQuoteCalculationFailedEvent.name;
  }

  static isRemotePaymentSendApprovedEvent(
    evt: DomainEvent
  ): evt is RemotePaymentSendApprovedEvent {
    return evt.msgName === RemotePaymentSendApprovedEvent.name;
  }

  static isRemotePaymentPreparedEvent(
    evt: DomainEvent
  ): evt is RemotePaymentPreparedEvent {
    return evt.msgName === RemotePaymentPreparedEvent.name;
  }

  static isPaymentFailedEvent(evt: DomainEvent): evt is PaymentFailedEvent {
    return evt.msgName === PaymentFailedEvent.name;
  }

  static isRemotePaymentSendConfirmedEvent(
    evt: DomainEvent
  ): evt is RemotePaymentSendConfirmedEvent {
    return evt.msgName === RemotePaymentSendConfirmedEvent.name;
  }

  static isRemotePaymentSendRejectedEvent(
    evt: DomainEvent
  ): evt is RemotePaymentSendRejectedEvent {
    return evt.msgName === RemotePaymentSendRejectedEvent.name;
  }

  static isInboundPaymentValidatedEvent(
    evt: DomainEvent
  ): evt is InboundPaymentValidatedEvent {
    return evt.msgName === InboundPaymentValidatedEvent.name;
  }

  static isInboundPaymentValidationFailedEvent(
    evt: DomainEvent
  ): evt is InboundPaymentValidationFailedEvent {
    return evt.msgName === InboundPaymentValidationFailedEvent.name;
  }

  static isInboundPaymentAcceptedEvent(
    evt: DomainEvent
  ): evt is InboundPaymentAcceptedEvent {
    return evt.msgName === InboundPaymentAcceptedEvent.name;
  }

  static isInboundPaymentFailedEvent(
    evt: DomainEvent
  ): evt is InboundPaymentFailedEvent {
    return evt.msgName === InboundPaymentFailedEvent.name;
  }

  static isInboundPaymentFulfillableEvent(
    evt: DomainEvent
  ): evt is InboundPaymentFulfillableEvent {
    return evt.msgName === InboundPaymentFulfillableEvent.name;
  }

  static isInboundPaymentFinalizedEvent(
    evt: DomainEvent
  ): evt is InboundPaymentFinalizedEvent {
    return evt.msgName === InboundPaymentFinalizedEvent.name;
  }
}

export type FailedMessagePayload = {
  errorName: string;
  errorType: AppErrorType;
  message: string;
};

export type PaymentIntentCreatedPayload = {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  incomingAmount: string | null;
  receivedAmount: string;
  state: PaymentIntentState;
  receiverWalletAddress: string;
  receiverWalletAddressId?: string;
  destination: string;
  assetCode: string;
  assetScale: number;
  metadata?: Record<string, unknown>;
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
} & FailedMessagePayload;

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
  receivedAmount: string;
  state: PaymentIntentState;
  receiverWalletAddress: string;
  receiverWalletAddressId?: string;
  destination: string;
  destinationIlpAddress?: string;
  assetCode: string;
  assetScale: number;
  metadata?: Record<string, unknown>;
};

export class PaymentIntentCompletedEvent extends PaymentIntentDomainEvent {
  payload: PaymentIntentCompletedPayload;

  constructor(payload: PaymentIntentCompletedPayload, requestId?: string) {
    super(payload.id);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type PaymentIntentCompleteFailedPayload = {
  id: string;
} & FailedMessagePayload;

export class PaymentIntentCompleteFailedEvent extends PaymentIntentDomainEvent {
  payload: PaymentIntentCompleteFailedPayload;
  isErrorEvent = true;

  constructor(payload: PaymentIntentCompleteFailedPayload, requestId?: string) {
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
  createdAt: string;
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
} & FailedMessagePayload;

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
  quoteId?: string;
  senderWalletAddress: string;
  senderWalletAddressId: string;
  debitAmount: string | null;
  receiveAmount: string | null;
  sentAmount: string | null;
  state: SentPaymentState;
  createdAt: Date;
  expiresAt: Date;
  assetCode: string;
  assetScale: number;
  receiveAssetScale: number;
  receiveAssetCode: string;
  paymentIntentRemoteUrl?: string;
  metadata?: Record<string, unknown>;
};

export class PaymentCreatedEvent extends PaymentIntentDomainEvent {
  payload: PaymentCreatedPayload;

  constructor(payload: PaymentCreatedPayload, requestId?: string) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type PaymentCreateFailedPayload = {
  paymentIntentId: string;
  grantId?: string;
} & FailedMessagePayload;

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
  grantId?: string;
  paymentIntentId: string;
  senderWalletAddress: string;
  senderWalletAddressId: string;
  debitAmount: string | null;
  receiveAmount: string | null;
  sentAmount: string | null;
  state: SentPaymentState;
  createdAt: Date;
  assetCode: string;
  assetScale: number;
  receiveAssetScale: number;
  receiveAssetCode: string;
  metadata?: Record<string, unknown>;
};

export class PaymentCompletedEvent extends PaymentIntentDomainEvent {
  payload: PaymentCompletedPayload;

  constructor(payload: PaymentCompletedPayload, requestId?: string) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type PaymentCompleteFailedAdditionalData = {
  walletAddressId?: string;
  sentAmount?: string;
  assetCode?: string;
  assetScale?: number;
};

export type PaymentCompleteFailedPayload = {
  id: string;
  paymentIntentId: string;
  grantId?: string;
} & FailedMessagePayload &
  PaymentCompleteFailedAdditionalData;

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
  grantId?: string;
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
  grantId?: string;
} & FailedMessagePayload;

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

export type RemoteQuoteCalculatedPayload = {
  packetId: string;
  peerId: string;
  paymentIntentId: string;
  receiveAmount: string;
  receiveAssetCode: string;
  receiveAssetScale: number;
};

export class RemoteQuoteCalculatedEvent extends PaymentIntentDomainEvent {
  payload: RemoteQuoteCalculatedPayload;

  constructor(payload: RemoteQuoteCalculatedPayload, requestId?: string) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type RemoteQuoteCalculationFailedPayload = {
  packetId: string;
  peerId: string;
  paymentIntentId: string;
} & FailedMessagePayload;

export class RemoteQuoteCalculationFailedEvent extends PaymentIntentDomainEvent {
  payload: RemoteQuoteCalculationFailedPayload;
  isErrorEvent = true;

  constructor(
    payload: RemoteQuoteCalculationFailedPayload,
    requestId?: string
  ) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type RemotePaymentSendApprovedPayload = {
  paymentIntentId: string;
  paymentId: string;
  state: SentPaymentState;
  senderWalletAddress: string;
  senderWalletAddressId: string;
  destinationIlpAddress: string;
  peerId: string;
  requestId: string;
  debitAmount: string;
  assetCode: string;
  assetScale: number;
  transferId?: string;
};

export class RemotePaymentSendApprovedEvent extends PaymentIntentDomainEvent {
  payload: RemotePaymentSendApprovedPayload;

  constructor(payload: RemotePaymentSendApprovedPayload, requestId?: string) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type RemotePaymentPreparedPayload = {
  paymentIntentId: string;
  paymentId: string;
  ledgerTransferId: string;
  destinationIlpAddress: string;
  peerId: string;
  requestId: string;
  debitAmount: string;
  receiveAmount: string | null;
  assetCode: string;
  assetScale: number;
  sharedSecret: string;
  expiresAt: string;
};

export class RemotePaymentPreparedEvent extends PaymentIntentDomainEvent {
  payload: RemotePaymentPreparedPayload;

  constructor(payload: RemotePaymentPreparedPayload, requestId?: string) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type PaymentFailedPayload = {
  id: string;
  grantId?: string;
  paymentIntentId: string;
  senderWalletAddress: string;
  debitAmount: string | null;
  receiveAmount: string | null;
  sentAmount: string | null;
  state: SentPaymentState;
  createdAt: Date;
  assetCode: string;
  assetScale: number;
  receiveAssetCode: string;
  receiveAssetScale: number;
  reason?: string;
};

export class PaymentFailedEvent extends PaymentIntentDomainEvent {
  payload: PaymentFailedPayload;
  isErrorEvent = true;

  constructor(payload: PaymentFailedPayload, requestId?: string) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type RemotePaymentSendConfirmedPayload = {
  paymentIntentId: string;
  paymentId: string;
  ledgerTransferId: string;
  destinationIlpAddress: string;
  peerId: string;
  requestId: string;
  debitAmount: string;
  assetCode: string;
  assetScale: number;
};

export class RemotePaymentSendConfirmedEvent extends PaymentIntentDomainEvent {
  payload: RemotePaymentSendConfirmedPayload;

  constructor(payload: RemotePaymentSendConfirmedPayload, requestId?: string) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type RemotePaymentSendRejectedPayload = {
  paymentIntentId: string;
  paymentId: string;
  ledgerTransferId: string;
  reason?: string;
  rejectCode?: string;
  rejectMessage?: string;
  destinationIlpAddress: string;
  peerId: string;
  requestId: string;
  debitAmount: string;
  assetCode: string;
  assetScale: number;
};

export class RemotePaymentSendRejectedEvent extends PaymentIntentDomainEvent {
  payload: RemotePaymentSendRejectedPayload;

  constructor(payload: RemotePaymentSendRejectedPayload, requestId?: string) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type InboundPaymentValidatedPayload = {
  paymentIntentId: string;
  inboundPaymentId: string;
  packetId: string;
  peerId: string;
  requestId: string;
  sourceAmount: string;
  peerAssetCode: string;
  peerAssetScale: number;
  receiveAmount: string;
  receiveAssetCode: string;
  receiveAssetScale: number;
  receiverWalletAddressId?: string;
  state: InboundPaymentState;
  createdAt: Date;
};

export class InboundPaymentValidatedEvent extends PaymentIntentDomainEvent {
  payload: InboundPaymentValidatedPayload;

  constructor(payload: InboundPaymentValidatedPayload, requestId?: string) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type InboundPaymentValidationFailedPayload = {
  paymentIntentId: string;
  inboundPaymentId: string;
  packetId: string;
  peerId: string;
} & FailedMessagePayload;

export class InboundPaymentValidationFailedEvent extends PaymentIntentDomainEvent {
  payload: InboundPaymentValidationFailedPayload;
  isErrorEvent = true;

  constructor(
    payload: InboundPaymentValidationFailedPayload,
    requestId?: string
  ) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type InboundPaymentAcceptedPayload = {
  paymentIntentId: string;
  inboundPaymentId: string;
  packetId: string;
  peerId: string;
  requestId: string;
  ledgerTransferId: string;
  receiveAmount: string;
  receiveAssetCode: string;
  receiveAssetScale: number;
  state: InboundPaymentState;
};

export class InboundPaymentAcceptedEvent extends PaymentIntentDomainEvent {
  payload: InboundPaymentAcceptedPayload;

  constructor(payload: InboundPaymentAcceptedPayload, requestId?: string) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type InboundPaymentFailedPayload = {
  paymentIntentId: string;
  inboundPaymentId: string;
  packetId?: string;
  peerId?: string;
} & FailedMessagePayload;

export class InboundPaymentFailedEvent extends PaymentIntentDomainEvent {
  payload: InboundPaymentFailedPayload;
  isErrorEvent = true;

  constructor(payload: InboundPaymentFailedPayload, requestId?: string) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type InboundPaymentFulfillablePayload = {
  paymentIntentId: string;
  inboundPaymentId: string;
  packetId: string;
  peerId: string;
  requestId: string;
  receiveAmount: string;
  receiveAssetCode: string;
  receiveAssetScale: number;
  state: InboundPaymentState;
};

export class InboundPaymentFulfillableEvent extends PaymentIntentDomainEvent {
  payload: InboundPaymentFulfillablePayload;

  constructor(payload: InboundPaymentFulfillablePayload, requestId?: string) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type InboundPaymentFinalizedPayload = {
  paymentIntentId: string;
  inboundPaymentId: string;
  packetId: string;
  peerId: string;
  sourceAmount: string;
  receiveAmount: string;
  receiveAssetCode: string;
  receiveAssetScale: number;
  state: InboundPaymentState;
};

export class InboundPaymentFinalizedEvent extends PaymentIntentDomainEvent {
  payload: InboundPaymentFinalizedPayload;

  constructor(payload: InboundPaymentFinalizedPayload, requestId?: string) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type PaymentIntentExpiredPayload = {
  paymentIntentId: string;
  state: PaymentIntentState;
};

export class PaymentIntentExpiredEvent extends PaymentIntentDomainEvent {
  payload: PaymentIntentExpiredPayload;
  constructor(payload: PaymentIntentExpiredPayload, requestId?: string) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type PaymentIntentExpireFailedPayload = {
  paymentIntentId: string;
} & FailedMessagePayload;

export class PaymentIntentExpireFailedEvent extends PaymentIntentDomainEvent {
  payload: PaymentIntentExpireFailedPayload;
  isErrorEvent = true;
  constructor(payload: PaymentIntentExpireFailedPayload, requestId?: string) {
    super(payload.paymentIntentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type PaymentExpireFailedPayload = {
  paymentId: string;
} & FailedMessagePayload;

export class PaymentExpireFailedEvent extends PaymentIntentDomainEvent {
  payload: PaymentExpireFailedPayload;
  isErrorEvent = true;
  constructor(payload: PaymentExpireFailedPayload, requestId?: string) {
    super(payload.paymentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type PaymentExpiredPayload = {
  paymentIntentId: string;
  paymentId: string;
};
export class PaymentExpiredEvent extends PaymentIntentDomainEvent {
  payload: PaymentExpiredPayload;

  constructor(payload: PaymentExpiredPayload, requestId?: string) {
    super(payload.paymentId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export class CheckExpirationEvent extends TimerEvent {
  payload: undefined;
  msgTopic: string = TimerEventTopics.PaymentExpiredTimeEvents;
  constructor(requestId: string) {
    super(requestId);
    this.payload = undefined;
  }
}
