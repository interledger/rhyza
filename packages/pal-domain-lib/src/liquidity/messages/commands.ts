import {
  CommandMsg,
  CommandTopics,
  MessageDataFormats
} from 'common-types-lib';

const DATAFORMAT = MessageDataFormats.JSON;

export abstract class LedgerCommand extends CommandMsg {
  msgDataFormat: MessageDataFormats = DATAFORMAT;
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

  // High-level commands
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

  // High-level liquidity managment commands
  static isDepositToPeerCmd(cmd: CommandMsg): cmd is DepositToPeerCmd {
    return cmd.msgName === DepositToPeerCmd.name;
  }
  static isWithdrawFromPeerCmd(cmd: CommandMsg): cmd is WithdrawFromPeerCmd {
    return cmd.msgName === WithdrawFromPeerCmd.name;
  }
  static isDepositToAseCmd(cmd: CommandMsg): cmd is DepositToAseCmd {
    return cmd.msgName === DepositToAseCmd.name;
  }
  static isWithdrawFromAseCmd(cmd: CommandMsg): cmd is WithdrawFromAseCmd {
    return cmd.msgName === WithdrawFromAseCmd.name;
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

/*
 * High-level transfer commands
 * */

export type CheckBalanceAndReserveTransferCmdPayload = {
  requestId: string;
  transferId: string;
  peerId: string;
  amount: string;
  amountScale: number;
  transferDirection: 'INCOMING' | 'OUTGOING';
  paymentIntentId: string;
  paymentId: string;
};
export class CheckBalanceAndReserveTransferCmd extends LedgerCommand {
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
  peerId: string;
  amount: string;
  amountScale: number;
  transferDirection: 'INCOMING' | 'OUTGOING';
  paymentIntentId: string;
  paymentId: string;
};
export class ReserveTransferCmd extends LedgerCommand {
  payload: ReserveTransferCmdPayload;
  constructor(aggId: string, payload: ReserveTransferCmdPayload) {
    super(aggId);
    this.payload = payload;
  }
}

export type CommitOrRejectTransferCmdPayload = {
  requestId: string;
  transferId: string;
  transferDirection: 'INCOMING' | 'OUTGOING';
  paymentIntentId: string;
  paymentId: string;
};
export class CommitTransferCmd extends LedgerCommand {
  payload: CommitOrRejectTransferCmdPayload;
  constructor(aggId: string, payload: CommitOrRejectTransferCmdPayload) {
    super(aggId);
    this.payload = payload;
  }
}

export class RejectTransferCmd extends LedgerCommand {
  payload: CommitOrRejectTransferCmdPayload;
  constructor(aggId: string, payload: CommitOrRejectTransferCmdPayload) {
    super(aggId);
    this.payload = payload;
  }
}

/*
 * High-level liquidity management commands
 * */

export type LiquidityManagementCmdPayload = {
  requestId: string;
  peerId: string;
  assetCode: string;
  amount: string;
  amountScale: number;
  externalId?: string;
};
export class DepositToPeerCmd extends LedgerCommand {
  payload: LiquidityManagementCmdPayload;
  constructor(payload: LiquidityManagementCmdPayload) {
    super(payload.assetCode);
    this.payload = payload;
  }
}

export class WithdrawFromPeerCmd extends LedgerCommand {
  payload: LiquidityManagementCmdPayload;
  constructor(payload: LiquidityManagementCmdPayload) {
    super(payload.assetCode);
    this.payload = payload;
  }
}
export class DepositToAseCmd extends LedgerCommand {
  payload: LiquidityManagementCmdPayload;
  constructor(payload: LiquidityManagementCmdPayload) {
    super(payload.assetCode);
    this.payload = payload;
  }
}

export class WithdrawFromAseCmd extends LedgerCommand {
  payload: LiquidityManagementCmdPayload;
  constructor(payload: LiquidityManagementCmdPayload) {
    super(payload.assetCode);
    this.payload = payload;
  }
}
