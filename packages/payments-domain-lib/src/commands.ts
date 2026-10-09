import { AppErrorType, CommandMsg, CommandTopics } from 'common-types-lib';

export abstract class PaymentIntentCommand extends CommandMsg {
  msgTopic: string = CommandTopics.PaymentCommands;

  protected constructor(aggId: string) {
    super(aggId);
    this.msgKey = aggId;
  }

  static isCreatePaymentIntentCmd(
    cmd: CommandMsg
  ): cmd is CreatePaymentIntentCmd {
    return cmd.msgName === CreatePaymentIntentCmd.name;
  }

  static isCreateQuoteCmd(cmd: CommandMsg): cmd is CreateQuoteCmd {
    return cmd.msgName === CreateQuoteCmd.name;
  }

  static isCreatePaymentCmd(cmd: CommandMsg): cmd is CreatePaymentCmd {
    return cmd.msgName === CreatePaymentCmd.name;
  }

  static isApprovePaymentCmd(cmd: CommandMsg): cmd is ApprovePaymentCmd {
    return cmd.msgName === ApprovePaymentCmd.name;
  }

  static isCompleteRemoteQuoteCmd(
    cmd: CommandMsg
  ): cmd is CompleteRemoteQuoteCmd {
    return cmd.msgName === CompleteRemoteQuoteCmd.name;
  }

  static isFailRemoteQuoteCmd(cmd: CommandMsg): cmd is FailRemoteQuoteCmd {
    return cmd.msgName === FailRemoteQuoteCmd.name;
  }

  static isCalculateRemoteQuoteCmd(
    cmd: CommandMsg
  ): cmd is CalculateRemoteQuoteCmd {
    return cmd.msgName === CalculateRemoteQuoteCmd.name;
  }

  static isPrepareRemotePaymentCmd(
    cmd: CommandMsg
  ): cmd is PrepareRemotePaymentCmd {
    return cmd.msgName === PrepareRemotePaymentCmd.name;
  }

  static isFailRemotePaymentCmd(cmd: CommandMsg): cmd is FailRemotePaymentCmd {
    return cmd.msgName === FailRemotePaymentCmd.name;
  }

  static isConfirmRemotePaymentCmd(
    cmd: CommandMsg
  ): cmd is ConfirmRemotePaymentCmd {
    return cmd.msgName === ConfirmRemotePaymentCmd.name;
  }

  static isRejectRemotePaymentCmd(
    cmd: CommandMsg
  ): cmd is RejectRemotePaymentCmd {
    return cmd.msgName === RejectRemotePaymentCmd.name;
  }

  static isCompleteRemotePaymentCmd(
    cmd: CommandMsg
  ): cmd is CompleteRemotePaymentCmd {
    return cmd.msgName === CompleteRemotePaymentCmd.name;
  }

  static isValidateInboundPaymentCmd(
    cmd: CommandMsg
  ): cmd is ValidateInboundPaymentCmd {
    return cmd.msgName === ValidateInboundPaymentCmd.name;
  }

  static isAcceptInboundPaymentCmd(
    cmd: CommandMsg
  ): cmd is AcceptInboundPaymentCmd {
    return cmd.msgName === AcceptInboundPaymentCmd.name;
  }

  static isFailInboundPaymentCmd(
    cmd: CommandMsg
  ): cmd is FailInboundPaymentCmd {
    return cmd.msgName === FailInboundPaymentCmd.name;
  }

  static isFinalizeInboundPaymentCmd(
    cmd: CommandMsg
  ): cmd is FinalizeInboundPaymentCmd {
    return cmd.msgName === FinalizeInboundPaymentCmd.name;
  }

  static isMarkInboundPaymentFulfillableCmd(
    cmd: CommandMsg
  ): cmd is MarkInboundPaymentFulfillableCmd {
    return cmd.msgName === MarkInboundPaymentFulfillableCmd.name;
  }
}

export type CreatePaymentIntentCmdPayload = {
  id: string;
  receiverWalletAddressId: string;
  receiverWalletAddress: string;
  expiresAt?: string;
  incomingAmount?: number;
  metadata?: string;
};

export class CreatePaymentIntentCmd extends PaymentIntentCommand {
  payload: CreatePaymentIntentCmdPayload;

  constructor(payload: CreatePaymentIntentCmdPayload, requestId: string) {
    super(payload.id);
    this.requestId = requestId;
    this.payload = payload;
  }
}

export type CompletePaymentIntentCmdPayload = {
  id: string;
};

export class CompletePaymentIntentCmd extends PaymentIntentCommand {
  payload: CompletePaymentIntentCmdPayload;

  constructor(payload: CompletePaymentIntentCmdPayload, requestId: string) {
    super(payload.id);
    this.requestId = requestId;
    this.payload = payload;
  }
}

export type CreateQuoteCmdPayload = {
  id: string;
  paymentIntentId: string;
  senderWalletAddress: string;
  senderWalletAddressId: string;
  debitAmount?: number;
  receiveAmount?: number;
  remoteUrl?: string;
};

export class CreateQuoteCmd extends PaymentIntentCommand {
  payload: CreateQuoteCmdPayload;

  constructor(payload: CreateQuoteCmdPayload, requestId: string) {
    super(payload.paymentIntentId);
    this.requestId = requestId;
    this.payload = payload;
  }
}

export type CreatePaymentCmdPayload = {
  id: string;
  senderWalletAddress: string;
  senderWalletAddressId: string;
  paymentIntentId: string;
  quoteId?: string;
  debitAmount?: number;
  grantId?: string;
  metadata?: string;
};

export class CreatePaymentCmd extends PaymentIntentCommand {
  payload: CreatePaymentCmdPayload;

  constructor(payload: CreatePaymentCmdPayload, requestId: string) {
    super(payload.paymentIntentId);
    this.requestId = requestId;
    this.payload = payload;
  }
}

export type ApprovePaymentCmdPayload = {
  id: string;
  paymentIntentId: string;
};

export class ApprovePaymentCmd extends PaymentIntentCommand {
  payload: ApprovePaymentCmdPayload;

  constructor(payload: ApprovePaymentCmdPayload, requestId: string) {
    super(payload.paymentIntentId);
    this.requestId = requestId;
    this.payload = payload;
  }
}

export type CancelPaymentCmdPayload = {
  id: string;
  paymentIntentId: string;
  reason?: string;
};

export class CancelPaymentCmd extends PaymentIntentCommand {
  payload: CancelPaymentCmdPayload;

  constructor(payload: CancelPaymentCmdPayload, requestId: string) {
    super(payload.paymentIntentId);
    this.requestId = requestId;
    this.payload = payload;
  }
}

export type CompleteRemoteQuoteCmdPayload = {
  quoteId: string;
  paymentIntentId: string;
  receiveAmountValue: string;
};

export class CompleteRemoteQuoteCmd extends PaymentIntentCommand {
  payload: CompleteRemoteQuoteCmdPayload;

  constructor(payload: CompleteRemoteQuoteCmdPayload, requestId: string) {
    super(payload.paymentIntentId);
    this.requestId = requestId;
    this.payload = payload;
  }
}

export type FailRemoteQuoteCmdPayload = {
  quoteId: string;
  paymentIntentId: string;
  errorName: string;
  errorType?: AppErrorType;
  message: string;
};

export class FailRemoteQuoteCmd extends PaymentIntentCommand {
  payload: FailRemoteQuoteCmdPayload;

  constructor(payload: FailRemoteQuoteCmdPayload, requestId: string) {
    super(payload.paymentIntentId);
    this.requestId = requestId;
    this.payload = payload;
  }
}

export type CalculateRemoteQuoteCmdPayload = {
  packetId: string;
  peerId: string;
  paymentIntentId: string;
  sourceAmount: string;
};

export class CalculateRemoteQuoteCmd extends PaymentIntentCommand {
  payload: CalculateRemoteQuoteCmdPayload;

  constructor(payload: CalculateRemoteQuoteCmdPayload, requestId: string) {
    super(payload.paymentIntentId);
    this.requestId = requestId;
    this.payload = payload;
  }
}

export type PrepareRemotePaymentCmdPayload = {
  paymentIntentId: string;
  paymentId: string;
  ledgerTransferId: string;
};

export class PrepareRemotePaymentCmd extends PaymentIntentCommand {
  payload: PrepareRemotePaymentCmdPayload;

  constructor(payload: PrepareRemotePaymentCmdPayload, requestId: string) {
    super(payload.paymentIntentId);
    this.requestId = requestId;
    this.payload = payload;
  }
}

export type FailRemotePaymentCmdPayload = {
  paymentIntentId: string;
  paymentId: string;
  reason?: string;
};

export class FailRemotePaymentCmd extends PaymentIntentCommand {
  payload: FailRemotePaymentCmdPayload;

  constructor(payload: FailRemotePaymentCmdPayload, requestId: string) {
    super(payload.paymentIntentId);
    this.requestId = requestId;
    this.payload = payload;
  }
}

export type ConfirmRemotePaymentCmdPayload = {
  paymentIntentId: string;
  paymentId: string;
};

export class ConfirmRemotePaymentCmd extends PaymentIntentCommand {
  payload: ConfirmRemotePaymentCmdPayload;

  constructor(payload: ConfirmRemotePaymentCmdPayload, requestId: string) {
    super(payload.paymentIntentId);
    this.requestId = requestId;
    this.payload = payload;
  }
}

export type RejectRemotePaymentCmdPayload = {
  paymentIntentId: string;
  paymentId: string;
  reason?: string;
  rejectCode?: string;
  rejectMessage?: string;
};

export class RejectRemotePaymentCmd extends PaymentIntentCommand {
  payload: RejectRemotePaymentCmdPayload;

  constructor(payload: RejectRemotePaymentCmdPayload, requestId: string) {
    super(payload.paymentIntentId);
    this.requestId = requestId;
    this.payload = payload;
  }
}

export type CompleteRemotePaymentCmdPayload = {
  paymentIntentId: string;
  paymentId: string;
};

export class CompleteRemotePaymentCmd extends PaymentIntentCommand {
  payload: CompleteRemotePaymentCmdPayload;

  constructor(payload: CompleteRemotePaymentCmdPayload, requestId: string) {
    super(payload.paymentIntentId);
    this.requestId = requestId;
    this.payload = payload;
  }
}

export type ValidateInboundPaymentCmdPayload = {
  id: string;
  paymentIntentId: string;
  packetId: string;
  peerId: string;
  sourceAmount: string;
  expiresAt?: string;
};

export class ValidateInboundPaymentCmd extends PaymentIntentCommand {
  payload: ValidateInboundPaymentCmdPayload;

  constructor(payload: ValidateInboundPaymentCmdPayload, requestId: string) {
    super(payload.paymentIntentId);
    this.requestId = requestId;
    this.payload = payload;
  }
}

export type AcceptInboundPaymentCmdPayload = {
  inboundPaymentId: string;
  paymentIntentId: string;
  ledgerTransferId: string;
};

export class AcceptInboundPaymentCmd extends PaymentIntentCommand {
  payload: AcceptInboundPaymentCmdPayload;

  constructor(payload: AcceptInboundPaymentCmdPayload, requestId: string) {
    super(payload.paymentIntentId);
    this.requestId = requestId;
    this.payload = payload;
  }
}

export type FailInboundPaymentCmdPayload = {
  inboundPaymentId: string;
  paymentIntentId: string;
  reason?: string;
};

export class FailInboundPaymentCmd extends PaymentIntentCommand {
  payload: FailInboundPaymentCmdPayload;

  constructor(payload: FailInboundPaymentCmdPayload, requestId: string) {
    super(payload.paymentIntentId);
    this.requestId = requestId;
    this.payload = payload;
  }
}

export type MarkInboundPaymentFulfillableCmdPayload = {
  inboundPaymentId: string;
  paymentIntentId: string;
};

export class MarkInboundPaymentFulfillableCmd extends PaymentIntentCommand {
  payload: MarkInboundPaymentFulfillableCmdPayload;

  constructor(
    payload: MarkInboundPaymentFulfillableCmdPayload,
    requestId: string
  ) {
    super(payload.paymentIntentId);
    this.requestId = requestId;
    this.payload = payload;
  }
}

export type FinalizeInboundPaymentCmdPayload = {
  inboundPaymentId: string;
  paymentIntentId: string;
};

export class FinalizeInboundPaymentCmd extends PaymentIntentCommand {
  payload: FinalizeInboundPaymentCmdPayload;

  constructor(payload: FinalizeInboundPaymentCmdPayload, requestId: string) {
    super(payload.paymentIntentId);
    this.requestId = requestId;
    this.payload = payload;
  }
}
