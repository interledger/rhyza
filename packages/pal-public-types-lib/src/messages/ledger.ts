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
  static isLedgerOutgoingTransferReservedEvent(
    evt: DomainEvent
  ): evt is LedgerOutgoingTransferReservedEvent {
    return evt.msgName === LedgerOutgoingTransferReservedEvent.name;
  }
  static isLedgerIncomingTransferReservedEvent(
    evt: DomainEvent
  ): evt is LedgerIncomingTransferReservedEvent {
    return evt.msgName === LedgerIncomingTransferReservedEvent.name;
  }
  static isLedgerOutgoingTransferInsufficientFundsErrorEvent(
    evt: DomainEvent
  ): evt is LedgerOutgoingTransferInsufficientFundsErrorEvent {
    return (
      evt.msgName === LedgerOutgoingTransferInsufficientFundsErrorEvent.name
    );
  }
  static isLedgerIncomingTransferInsufficientFundsErrorEvent(
    evt: DomainEvent
  ): evt is LedgerIncomingTransferInsufficientFundsErrorEvent {
    return (
      evt.msgName === LedgerIncomingTransferInsufficientFundsErrorEvent.name
    );
  }
  static isLedgerOutgoingTransferCommittedEvent(
    evt: DomainEvent
  ): evt is LedgerOutgoingTransferCommittedEvent {
    return evt.msgName === LedgerOutgoingTransferCommittedEvent.name;
  }
  static isLedgerIncomingTransferCommittedEvent(
    evt: DomainEvent
  ): evt is LedgerIncomingTransferCommittedEvent {
    return evt.msgName === LedgerIncomingTransferCommittedEvent.name;
  }
  static isLedgerOutgoingTransferRejectedEvent(
    evt: DomainEvent
  ): evt is LedgerOutgoingTransferRejectedEvent {
    return evt.msgName === LedgerOutgoingTransferRejectedEvent.name;
  }
  static isLedgerIncomingTransferRejectedEvent(
    evt: DomainEvent
  ): evt is LedgerIncomingTransferRejectedEvent {
    return evt.msgName === LedgerIncomingTransferRejectedEvent.name;
  }
  static isLedgerOutgoingTransferCheckBalanceAndReserveFailedEvent(
    evt: DomainEvent
  ): evt is LedgerOutgoingTransferCheckBalanceAndReserveFailedEvent {
    return (
      evt.msgName ===
      LedgerOutgoingTransferCheckBalanceAndReserveFailedEvent.name
    );
  }
  static isLedgerOutgoingTransferCommitFailedEvent(
    evt: DomainEvent
  ): evt is LedgerOutgoingTransferCommitFailedEvent {
    return evt.msgName === LedgerOutgoingTransferCommitFailedEvent.name;
  }
  static isLedgerOutgoingTransferRejectFailedEvent(
    evt: DomainEvent
  ): evt is LedgerOutgoingTransferRejectFailedEvent {
    return evt.msgName === LedgerOutgoingTransferRejectFailedEvent.name;
  }
  static isLedgerIncomingTransferReserveFailedEvent(
    evt: DomainEvent
  ): evt is LedgerIncomingTransferReserveFailedEvent {
    return evt.msgName === LedgerIncomingTransferReserveFailedEvent.name;
  }
  static isLedgerIncomingTransferCommitFailedEvent(
    evt: DomainEvent
  ): evt is LedgerIncomingTransferCommitFailedEvent {
    return evt.msgName === LedgerIncomingTransferCommitFailedEvent.name;
  }

  // Liq management success events
  static isLedgerDepositToPeerSucceededEvent(
    evt: DomainEvent
  ): evt is LedgerDepositToPeerSucceededEvent {
    return evt.msgName === LedgerDepositToPeerSucceededEvent.name;
  }
  static isLedgerDepositToAseSucceededEvent(
    evt: DomainEvent
  ): evt is LedgerDepositToAseSucceededEvent {
    return evt.msgName === LedgerDepositToAseSucceededEvent.name;
  }
  static isLedgerWithdrawFromPeerSucceededEvent(
    evt: DomainEvent
  ): evt is LedgerWithdrawFromPeerSucceededEvent {
    return evt.msgName === LedgerWithdrawFromPeerSucceededEvent.name;
  }
  static isLedgerWithdrawFromAseSucceededEvent(
    evt: DomainEvent
  ): evt is LedgerWithdrawFromAseSucceededEvent {
    return evt.msgName === LedgerWithdrawFromAseSucceededEvent.name;
  }

  // Liq management failure events
  static isLedgerDepositToPeerFailedEvent(
    evt: DomainEvent
  ): evt is LedgerDepositToPeerFailedEvent {
    return evt.msgName === LedgerDepositToPeerFailedEvent.name;
  }
  static isLedgerDepositToAseFailedEvent(
    evt: DomainEvent
  ): evt is LedgerDepositToAseFailedEvent {
    return evt.msgName === LedgerDepositToAseFailedEvent.name;
  }
  static isLedgerWithdrawFromPeerFailedEvent(
    evt: DomainEvent
  ): evt is LedgerWithdrawFromPeerFailedEvent {
    return evt.msgName === LedgerWithdrawFromPeerFailedEvent.name;
  }
  static isLedgerWithdrawFromAseFailedEvent(
    evt: DomainEvent
  ): evt is LedgerWithdrawFromAseFailedEvent {
    return evt.msgName === LedgerWithdrawFromAseFailedEvent.name;
  }
  static isLedgerWithdrawFromPeerFailedWithInsufficientFundsEvent(
    evt: DomainEvent
  ): evt is LedgerWithdrawFromPeerFailedWithInsufficientFundsEvent {
    return (
      evt.msgName ===
      LedgerWithdrawFromPeerFailedWithInsufficientFundsEvent.name
    );
  }
  static isLedgerWithdrawFromAseFailedWithInsufficientFundsEvent(
    evt: DomainEvent
  ): evt is LedgerWithdrawFromAseFailedWithInsufficientFundsEvent {
    return (
      evt.msgName === LedgerWithdrawFromAseFailedWithInsufficientFundsEvent.name
    );
  }
}

/*
 * Domain Events (for now sort of integration events as well)
 * */

/*
 * low level events
 */

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

/*
 * Liquidity management events
 */

// success events
export type LedgerLiquidityManagementSuccessEventPayload = {
  peerId: string;
  requestId: string;
  externalId?: string;
};
export class LedgerLiquidityManagementSuccessEvent extends LedgerDomainEvent {
  payload: LedgerLiquidityManagementSuccessEventPayload;

  constructor(
    aggId: string,
    payload: LedgerLiquidityManagementSuccessEventPayload
  ) {
    super(aggId);
    this.msgKey = aggId;
    this.payload = payload;
  }
}
export class LedgerDepositToPeerSucceededEvent extends LedgerLiquidityManagementSuccessEvent {}
export class LedgerDepositToAseSucceededEvent extends LedgerLiquidityManagementSuccessEvent {}
export class LedgerWithdrawFromPeerSucceededEvent extends LedgerLiquidityManagementSuccessEvent {}
export class LedgerWithdrawFromAseSucceededEvent extends LedgerLiquidityManagementSuccessEvent {}

// failure events
export type LedgerLiquidityManagementFailureEventPayload =
  LedgerLiquidityManagementSuccessEventPayload & {
    errorMessage: string;
  };
export class LedgerLiquidityManagementFailureEvent extends LedgerDomainEvent {
  payload: LedgerLiquidityManagementFailureEventPayload;
  isErrorEvent = true;

  constructor(
    aggId: string,
    payload: LedgerLiquidityManagementFailureEventPayload
  ) {
    super(aggId);
    this.msgKey = aggId;
    this.payload = payload;
  }
}

export class LedgerDepositToPeerFailedEvent extends LedgerLiquidityManagementFailureEvent {}
export class LedgerDepositToAseFailedEvent extends LedgerLiquidityManagementFailureEvent {}
export class LedgerWithdrawFromPeerFailedEvent extends LedgerLiquidityManagementFailureEvent {}
export class LedgerWithdrawFromAseFailedEvent extends LedgerLiquidityManagementFailureEvent {}

export class LedgerWithdrawFromPeerFailedWithInsufficientFundsEvent extends LedgerLiquidityManagementFailureEvent {}
export class LedgerWithdrawFromAseFailedWithInsufficientFundsEvent extends LedgerLiquidityManagementFailureEvent {}

/*
 * High-level success events
 */
// same payload for incoming or outgoing transfer events
export type LedgerHighLevelSuccessResponseEventPayload = {
  requestId: string;
  transferId: string;
  paymentIntentId: string;
  paymentId: string;
};

export class LedgerHighLevelSuccessResponseEvent extends LedgerDomainEvent {
  payload: LedgerHighLevelSuccessResponseEventPayload;
  isErrorEvent = true;

  constructor(
    aggId: string,
    payload: LedgerHighLevelSuccessResponseEventPayload
  ) {
    super(aggId);
    this.msgKey = aggId;
    this.payload = payload;
    this.requestId = payload.requestId;
  }
}

export class LedgerOutgoingTransferReservedEvent extends LedgerHighLevelSuccessResponseEvent {}
export class LedgerIncomingTransferReservedEvent extends LedgerHighLevelSuccessResponseEvent {}

export class LedgerOutgoingTransferCommittedEvent extends LedgerHighLevelSuccessResponseEvent {}
export class LedgerIncomingTransferCommittedEvent extends LedgerHighLevelSuccessResponseEvent {}

export class LedgerOutgoingTransferRejectedEvent extends LedgerHighLevelSuccessResponseEvent {}
export class LedgerIncomingTransferRejectedEvent extends LedgerHighLevelSuccessResponseEvent {}

/*
 * High-level transfer error events
 * All similar events have the same payload, only name differs
 */

export type LedgerHighLevelFailureResponseEventPayload =
  LedgerHighLevelSuccessResponseEventPayload & {
    errorMessage: string;
  };

export class LedgerHighLevelFailureResponseEvent extends LedgerDomainEvent {
  payload: LedgerHighLevelFailureResponseEventPayload;
  isErrorEvent = true;

  constructor(
    aggId: string,
    payload: LedgerHighLevelFailureResponseEventPayload
  ) {
    super(aggId);
    this.msgKey = aggId;
    this.payload = payload;
    this.requestId = payload.requestId;
  }
}

export class LedgerOutgoingTransferInsufficientFundsErrorEvent extends LedgerHighLevelFailureResponseEvent {}
export class LedgerIncomingTransferInsufficientFundsErrorEvent extends LedgerHighLevelFailureResponseEvent {}

export class LedgerOutgoingTransferCheckBalanceAndReserveFailedEvent extends LedgerHighLevelFailureResponseEvent {}
export class LedgerIncomingTransferCheckBalanceAndReserveFailedEvent extends LedgerHighLevelFailureResponseEvent {}

export class LedgerOutgoingTransferCommitFailedEvent extends LedgerHighLevelFailureResponseEvent {}
export class LedgerIncomingTransferCommitFailedEvent extends LedgerHighLevelFailureResponseEvent {}

export class LedgerOutgoingTransferRejectFailedEvent extends LedgerHighLevelFailureResponseEvent {}
export class LedgerIncomingTransferRejectFailedEvent extends LedgerHighLevelFailureResponseEvent {}

export class LedgerOutgoingTransferReserveFailedEvent extends LedgerHighLevelFailureResponseEvent {}
export class LedgerIncomingTransferReserveFailedEvent extends LedgerHighLevelFailureResponseEvent {}
