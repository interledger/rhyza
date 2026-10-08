import {
  StateEvent,
  SnapshotEvent,
  SnapshotEventTopics,
  StateEventTopics,
  MessageDataFormats,
  TimerEventTopics,
  TimerEvent
} from 'common-types-lib';

const DATAFORMAT = MessageDataFormats.JSON;

export abstract class LedgerStateEvent extends StateEvent {
  msgDataFormat: MessageDataFormats = DATAFORMAT;
  msgTopic: string = StateEventTopics.LedgerStateEvents;
  protected constructor(aggId: string) {
    super(aggId);
  }

  static isLedgerCreatedStateEvent(
    evt: StateEvent
  ): evt is LedgerCreatedStateEvent {
    return evt.msgName === LedgerCreatedStateEvent.name;
  }
  static isLedgerAccountsCreatedStateEvent(
    evt: StateEvent
  ): evt is LedgerAccountsCreatedStateEvent {
    return evt.msgName === LedgerAccountsCreatedStateEvent.name;
  }
  static isLedgerTransactionRecordedStateEvent(
    evt: StateEvent
  ): evt is LedgerTransactionRecordedStateEvent {
    return evt.msgName === LedgerTransactionRecordedStateEvent.name;
  }
}
export abstract class BaseLedgerSnapshotEvent extends SnapshotEvent {
  msgDataFormat: MessageDataFormats = DATAFORMAT;
  msgTopic: string = SnapshotEventTopics.LedgerSnapshotEvents;
  protected constructor(aggId: string, aggVersion: string) {
    super(aggId, aggVersion);
  }
}

/*
 * State Events
 * */

export type LedgerCreatedStatePayload = {
  id: string;
  assetScale: number;
};
export class LedgerCreatedStateEvent extends LedgerStateEvent {
  payload: LedgerCreatedStatePayload;

  constructor(aggId: string, assetScale: number) {
    super(aggId);
    this.aggregateVersion = '1';
    this.payload = {
      id: aggId,
      assetScale: assetScale
    };
  }
}

export type LedgerAccountsCreatedStatePayload = {
  accounts: {
    id: string;
    // must align with LedgerAccountTypes enum
    type:
      | 'ASSET_LIQUIDITY_ACCOUNT'
      | 'PEER_LIQUIDITY_ACCOUNT'
      | 'PEER_CLEARING_ACCOUNT'
      | 'ASE_LIQUIDITY_ACCOUNT'
      | 'ASE_CLEARING_ACCOUNT'
      | 'SUSPENSE_ACCOUNT';
    name: string;
    assetCode: string;
    assetDisplayScale: number;
    debitedAmount: string;
    creditedAmount: string;
    peerId?: string;
  }[];
};
export class LedgerAccountsCreatedStateEvent extends LedgerStateEvent {
  payload: LedgerAccountsCreatedStatePayload;

  constructor(aggId: string, payload: LedgerAccountsCreatedStatePayload) {
    super(aggId);
    this.payload = payload;
  }
}

export type LedgerTransactionRecordedStatePayload = {
  transaction: {
    id: string;
    originatingCommandName: string;
    debitedAccountId: string;
    creditedAccountId: string;
    amount: string;
    amountScale: number;
    timestamp: number;
    externalId?: string; // external liquidity id
    isReservation: boolean;
    voidsReservation: boolean;
    peerId: string;
    transferId?: string; //transferId for non-liquidity transaction
  };
};
export class LedgerTransactionRecordedStateEvent extends LedgerStateEvent {
  payload: LedgerTransactionRecordedStatePayload;

  constructor(aggId: string, payload: LedgerTransactionRecordedStatePayload) {
    super(aggId);
    this.payload = payload;
  }
}

/*
 * Snapshot Events
 * */
export type LedgerSnapshotPayload = {
  accounts: {
    id: string;
    type:
      | 'ASSET_LIQUIDITY_ACCOUNT'
      | 'PEER_LIQUIDITY_ACCOUNT'
      | 'PEER_CLEARING_ACCOUNT'
      | 'ASE_LIQUIDITY_ACCOUNT'
      | 'ASE_CLEARING_ACCOUNT'
      | 'SUSPENSE_ACCOUNT';
    name: string;
    assetCode: string;
    assetDisplayScale: number;
    debitedAmount: string;
    creditedAmount: string;
  }[];
  pendingTransfers: {
    transferId: string;
    peerId: string;
    amount: string;
    amountScale: number;
  }[];
  transactionCount: string;
  assetScale: number;
};
// export class LedgerSnapshotEvent extends BaseLedgerSnapshotEvent implements IProtobuffMessage<LedgerSnapshotEvent>{
export class LedgerSnapshotEvent extends BaseLedgerSnapshotEvent {
  payload: LedgerSnapshotPayload;

  constructor(
    aggId: string,
    aggVersion: string,
    payload: LedgerSnapshotPayload
  ) {
    super(aggId, aggVersion);
    this.payload = payload;
  }
}

export class LedgerSnapshotCheckTimerEvent extends TimerEvent {
  msgTopic: string = TimerEventTopics.LedgerTimerEvents;
  payload: undefined = undefined;

  constructor(aggId: string) {
    super(aggId);
  }
}
