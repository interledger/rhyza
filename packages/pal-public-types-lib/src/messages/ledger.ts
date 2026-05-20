import {
  DomainEvent,
  DomainEventTopics,
  MessageDataFormats
} from 'common-types-lib';

export abstract class LedgerDomainEvent extends DomainEvent {
  msgDataFormat: MessageDataFormats = MessageDataFormats.JSON;
  msgTopic: string = DomainEventTopics.LedgerEvents;
  // set to true by exception in then implementing class
  isErrorEvent = false;

  protected constructor(aggId: string) {
    super(aggId);
    this.requestId = crypto.randomUUID();
  }

  static isLedgerCreatedEvent(evt: DomainEvent): evt is LedgerCreatedEvent {
    return evt.msgName === LedgerCreatedEvent.name;
  }
  static isLedgerCreationFailedEvent(
    evt: DomainEvent
  ): evt is LedgerCreationFailedEvent {
    return evt.msgName === LedgerCreationFailedEvent.name;
  }
  static isLedgerNotFoundEvent(evt: DomainEvent): evt is LedgerNotFoundEvent {
    return evt.msgName === LedgerNotFoundEvent.name;
  }

  static isLedgerAccountCreatedForAssetEvent(
    evt: DomainEvent
  ): evt is LedgerAccountCreatedForAssetEvent {
    return evt.msgName === LedgerAccountCreatedForAssetEvent.name;
  }
  static isLedgerAccountNotFoundEvent(
    evt: DomainEvent
  ): evt is LedgerAccountCreationForAssetFailedEvent {
    return evt.msgName === LedgerAccountCreationForAssetFailedEvent.name;
  }

  static isLedgerAccountsCreatedForPeerEvent(
    evt: DomainEvent
  ): evt is LedgerAccountsCreatedForPeerEvent {
    return evt.msgName === LedgerAccountsCreatedForPeerEvent.name;
  }
  static isLedgerAccountCreationFailedEvent(
    evt: DomainEvent
  ): evt is LedgerAccountCreationForPeerFailedEvent {
    return evt.msgName === LedgerAccountCreationForPeerFailedEvent.name;
  }

  static isLedgerTransactionPostedEvent(
    evt: DomainEvent
  ): evt is LedgerTransactionPostedEvent {
    return evt.msgName === LedgerTransactionPostedEvent.name;
  }
  static isLedgerTransferReservedEvent(
    evt: DomainEvent
  ): evt is LedgerTransferReservedEvent {
    return evt.msgName === LedgerTransferReservedEvent.name;
  }
  static isLedgerTransferInsufficientFundsErrorEvent(
    evt: DomainEvent
  ): evt is LedgerTransferInsufficientFundsErrorEvent {
    return evt.msgName === LedgerTransferInsufficientFundsErrorEvent.name;
  }
  static isLedgerTransferCommitedEvent(
    evt: DomainEvent
  ): evt is LedgerTransferCommitedEvent {
    return evt.msgName === LedgerTransferCommitedEvent.name;
  }
  static isLedgerTransferRejectedEvent(
    evt: DomainEvent
  ): evt is LedgerTransferRejectedEvent {
    return evt.msgName === LedgerTransferRejectedEvent.name;
  }
}

/*
 * Domain Events (for now sort of integration events as well)
 * */

// low level events
export type LedgerCreatedEventPayload = {
  assetCode: string;
};
export class LedgerCreatedEvent extends LedgerDomainEvent {
  payload: LedgerCreatedEventPayload;

  constructor(payload: LedgerCreatedEventPayload) {
    super(payload.assetCode);
    this.msgKey = payload.assetCode;
    this.payload = payload;
  }
}

export type LedgerCreationFailedEventPayload = {
  assetCode: string;
  reason: 'DUPLICATE_ASSET_CODE' | 'UNKNOWN';
};
export class LedgerCreationFailedEvent extends LedgerDomainEvent {
  payload: LedgerCreationFailedEventPayload;
  isErrorEvent = true;

  constructor(payload: LedgerCreationFailedEventPayload) {
    super(payload.assetCode);
    this.msgKey = payload.assetCode;
    this.payload = payload;
  }
}

export type LedgerNotFoundEventPayload = {
  assetCode: string;
};
export class LedgerNotFoundEvent extends LedgerDomainEvent {
  payload: LedgerNotFoundEventPayload;
  isErrorEvent = true;
  constructor(payload: LedgerNotFoundEventPayload) {
    super(payload.assetCode);
    this.msgKey = payload.assetCode;
    this.payload = payload;
  }
}

export type LedgerAccountCreatedForAssetEventPayload = {
  id: string;
  assetCode: string;
};
export class LedgerAccountCreatedForAssetEvent extends LedgerDomainEvent {
  payload: LedgerAccountCreatedForAssetEventPayload;

  constructor(
    aggId: string,
    payload: LedgerAccountCreatedForAssetEventPayload
  ) {
    super(aggId);
    this.msgKey = payload.assetCode;
    this.payload = payload;
  }
}

export type LedgerAccountsCreatedForPeerEventPayload = {
  peerId: string;
  assetCode: string;
  peerLiquidityAccId: string;
  peerClearingAccId: string;
  aseLiquidityAccId: string;
  aseClearingAccId: string;
  suspenseAccId: string;
};
export class LedgerAccountsCreatedForPeerEvent extends LedgerDomainEvent {
  payload: LedgerAccountsCreatedForPeerEventPayload;

  constructor(
    aggId: string,
    payload: LedgerAccountsCreatedForPeerEventPayload
  ) {
    super(aggId);
    this.msgKey = payload.assetCode;
    this.payload = payload;
  }
}

export type LedgerAccountCreationForAssetFailedEventPayload = {
  assetCode: string;
  reason: 'DUPLICATE_ACCOUNT_ID' | 'ASSET_CODE_MISMATCH' | 'UNKNOWN';
};
export class LedgerAccountCreationForAssetFailedEvent extends LedgerDomainEvent {
  payload: LedgerAccountCreationForAssetFailedEventPayload;
  isErrorEvent = true;

  constructor(payload: LedgerAccountCreationForAssetFailedEventPayload) {
    super(payload.assetCode);
    this.msgKey = payload.assetCode;
    this.payload = payload;
  }
}

export type LedgerAccountCreationForPeerFailedEventPayload = {
  assetCode: string;
  peerId: string;
  reason: 'DUPLICATE_ACCOUNT_ID' | 'ASSET_CODE_MISMATCH' | 'UNKNOWN';
};
export class LedgerAccountCreationForPeerFailedEvent extends LedgerDomainEvent {
  payload: LedgerAccountCreationForPeerFailedEventPayload;
  isErrorEvent = true;

  constructor(payload: LedgerAccountCreationForPeerFailedEventPayload) {
    super(payload.assetCode);
    this.msgKey = payload.assetCode;
    this.payload = payload;
  }
}

export type LedgerAccountNotFoundEventPayload = {
  assetCode: string;
  accountId: string;
};
export class LedgerAccountNotFoundEvent extends LedgerDomainEvent {
  payload: LedgerAccountNotFoundEventPayload;
  isErrorEvent = true;
  constructor(payload: LedgerAccountNotFoundEventPayload) {
    super(payload.assetCode);
    this.msgKey = payload.assetCode;
    this.payload = payload;
  }
}

export type LedgerTransactionPostedEventPayload = {
  id: string;
  debitedAccountId: string;
  creditedAccountId: string;
  amount: string;
  amountScale: number;
  timestamp: number;
};
export class LedgerTransactionPostedEvent extends LedgerDomainEvent {
  payload: LedgerTransactionPostedEventPayload;

  constructor(aggId: string, payload: LedgerTransactionPostedEventPayload) {
    super(aggId);
    this.msgKey = aggId;
    this.payload = payload;
  }
}

// high level events
export type LedgerTransferResponseEventPayload = {
  requestId: string;
  transactionId: string;

  // for generic error handling (without dedicated error event)
  isError: boolean;
  errorMessage?: string;
};
export class LedgerTransferReservedEvent extends LedgerDomainEvent {
  payload: LedgerTransferResponseEventPayload;

  constructor(aggId: string, payload: LedgerTransferResponseEventPayload) {
    super(aggId);
    this.msgKey = aggId;
    this.payload = payload;
    this.requestId = payload.requestId;
  }
}
export class LedgerTransferInsufficientFundsErrorEvent extends LedgerDomainEvent {
  payload: LedgerTransferResponseEventPayload;
  isErrorEvent = true;

  constructor(aggId: string, requestId: string, transactionId: string) {
    super(aggId);
    this.msgKey = aggId;
    this.payload = {
      requestId: requestId,
      transactionId: transactionId,
      isError: true,
      errorMessage: 'Insufficient funds'
    };
    this.requestId = requestId;
  }
}

export class LedgerTransferCommitedEvent extends LedgerDomainEvent {
  payload: LedgerTransferResponseEventPayload;

  constructor(aggId: string, payload: LedgerTransferResponseEventPayload) {
    super(aggId);
    this.msgKey = aggId;
    this.payload = payload;
    this.requestId = payload.requestId;
  }
}

export class LedgerTransferRejectedEvent extends LedgerDomainEvent {
  payload: LedgerTransferResponseEventPayload;
  isErrorEvent = true;

  constructor(aggId: string, payload: LedgerTransferResponseEventPayload) {
    super(aggId);
    this.msgKey = aggId;
    this.payload = payload;
    this.requestId = payload.requestId;
  }
}
