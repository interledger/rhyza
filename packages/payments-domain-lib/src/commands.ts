import { CommandMsg, CommandTopics } from 'common-types-lib';

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

export type CreateQuoteCmdPayload = {
  id: string;
  paymentIntentId: string;
  senderWalletAddress: string;
  senderWalletAddressId: string;
  debitAmount?: number;
  receiveAmount?: number;
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
