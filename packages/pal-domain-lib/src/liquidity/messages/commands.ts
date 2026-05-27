import {
  CommandMsg,
  CommandTopics,
  MessageDataFormats
} from 'common-types-lib';

export abstract class LedgerCommand extends CommandMsg {
  msgDataFormat: MessageDataFormats = MessageDataFormats.JSON;
  msgTopic: string = CommandTopics.LedgerCommands;
  protected constructor(aggId: string) {
    super(aggId);
    this.msgKey = aggId;
  }

  // Low level commands
  static isCreateLedgerCmd(cmd: CommandMsg): cmd is CreateLedgerCmd {
    return cmd.msgName === CreateLedgerCmd.name;
  }
  static isCreateLedgerAccountForAssetCmd(
    cmd: CommandMsg
  ): cmd is CreateLedgerAccountForAssetCmd {
    return cmd.msgName === CreateLedgerAccountForAssetCmd.name;
  }
  static isCreateLedgerAccountsForPeerCmd(
    cmd: CommandMsg
  ): cmd is CreateLedgerAccountsForPeerCmd {
    return cmd.msgName === CreateLedgerAccountsForPeerCmd.name;
  }

  static isPostTransactionCmd(cmd: CommandMsg): cmd is PostTransactionCmd {
    return cmd.msgName === PostTransactionCmd.name;
  }

  // High level commands
  static isReserveTransferCmd(cmd: CommandMsg): cmd is ReserveTransferCmd {
    return cmd.msgName === ReserveTransferCmd.name;
  }
  static isCheckBalanceAndReserveTransferCmd(
    cmd: CommandMsg
  ): cmd is CheckBalanceAndReserveTransferCmd {
    return cmd.msgName === CheckBalanceAndReserveTransferCmd.name;
  }
  static isCommitTransferCmd(cmd: CommandMsg): cmd is CommitTransferCmd {
    return cmd.msgName === CommitTransferCmd.name;
  }
  static isRejectTransferCmd(cmd: CommandMsg): cmd is RejectTransferCmd {
    return cmd.msgName === RejectTransferCmd.name;
  }
}

/*
 * Lowlevel commands
 * */

export type CreateLedgerCmdPayload = {
  id: string;
};
export class CreateLedgerCmd extends LedgerCommand {
  payload: CreateLedgerCmdPayload;
  constructor(payload: CreateLedgerCmdPayload) {
    super(payload.id);
    this.payload = payload;
  }
}

export type CreateLedgerAccountForAssetCmdPayload = {
  id: string;
  assetCode: string; // assetCode is used as the acc externalId (being the account for an asset)
};
export class CreateLedgerAccountForAssetCmd extends LedgerCommand {
  payload: CreateLedgerAccountForAssetCmdPayload;
  constructor(aggId: string, payload: CreateLedgerAccountForAssetCmdPayload) {
    super(aggId);
    this.payload = payload;
  }
}

export type CreateLedgerAccountsForPeerCmdPayload = {
  peerId: string; // peerId is used as the acc externalId
  assetCode: string;
  peerLiquidityAccId: string;
  peerClearingAccId: string;
  aseLiquidityAccId: string;
  aseClearingAccId: string;
  suspenseAccId: string;
};
export class CreateLedgerAccountsForPeerCmd extends LedgerCommand {
  payload: CreateLedgerAccountsForPeerCmdPayload;
  constructor(aggId: string, payload: CreateLedgerAccountsForPeerCmdPayload) {
    super(aggId);
    this.payload = payload;
  }
}

export type PostTransactionCmdPayload = {
  id: string;
  debitedAccountId: string;
  creditedAccountId: string;
  amount: string;
  amountScale: number;
  transferId?: string;
};
export class PostTransactionCmd extends LedgerCommand {
  payload: PostTransactionCmdPayload;
  constructor(aggId: string, payload: PostTransactionCmdPayload) {
    super(aggId);
    this.payload = payload;
  }
}

/*
 * High level commands
 * */

export type CheckBalanceAndReserveTransferCmdPayload = {
  requestId: string;
  transferId: string;
  payerClearingAccountId: string;
  payerLiquidityAccountId: string;
  suspenseAccountId: string;
  amount: string;
  amountScale: number;
  transferDirection: 'INCOMING' | 'OUTGOING';
};
export class CheckBalanceAndReserveTransferCmd extends LedgerCommand {
  msgDataFormat: MessageDataFormats = MessageDataFormats.JSON;
  payload: CheckBalanceAndReserveTransferCmdPayload;
  constructor(
    aggId: string,
    payload: CheckBalanceAndReserveTransferCmdPayload
  ) {
    super(aggId);
    this.payload = payload;
  }
}

export type ReserveTransferCmdPayload = {
  requestId: string;
  transferId: string;
  payerClearingAccountId: string;
  suspenseAccountId: string;
  amount: string;
  amountScale: number;
  transferDirection: 'INCOMING' | 'OUTGOING';
};
export class ReserveTransferCmd extends LedgerCommand {
  msgDataFormat: MessageDataFormats = MessageDataFormats.JSON;
  payload: ReserveTransferCmdPayload;
  constructor(aggId: string, payload: ReserveTransferCmdPayload) {
    super(aggId);
    this.payload = payload;
  }
}

export type CommitTransferCmdPayload = {
  requestId: string;
  transferId: string;
  payerClearingAccountId: string;
  suspenseAccountId: string;
  payeeClearingAccountId: string;
  amount: string;
  amountScale: number;
  transferDirection: 'INCOMING' | 'OUTGOING';
};
export class CommitTransferCmd extends LedgerCommand {
  msgDataFormat: MessageDataFormats = MessageDataFormats.JSON;
  payload: CommitTransferCmdPayload;
  constructor(aggId: string, payload: CommitTransferCmdPayload) {
    super(aggId);
    this.payload = payload;
  }
}

export type RejectTransferCmdPayload = {
  requestId: string;
  transferId: string;
  payerClearingAccountId: string;
  suspenseAccountId: string;
  amount: string;
  amountScale: number;
  transferDirection: 'INCOMING' | 'OUTGOING';
};
export class RejectTransferCmd extends LedgerCommand {
  msgDataFormat: MessageDataFormats = MessageDataFormats.JSON;
  payload: RejectTransferCmdPayload;
  constructor(aggId: string, payload: RejectTransferCmdPayload) {
    super(aggId);
    this.payload = payload;
  }
}
