import { CommandMsg, CommandTopics } from 'common-types-lib';

const BOUNDED_CONTEXT_NAME = 'ilp';
const AGGREGATE_NAME = 'ilp-peer';

export interface StartRemoteQuoteCmdPayload {
  peerId: string;
  paymentIntentId: string;
  quoteId: string;
  destinationIlpAddress: string;
  sourceAmount: bigint;
  sourceAssetCode: string;
  sourceAssetScale: number;
}

export class StartRemoteQuoteCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.IlpCommands;
  payload: StartRemoteQuoteCmdPayload;

  constructor(payload: StartRemoteQuoteCmdPayload) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
  }
}

export interface StartRemotePaymentCmdPayload {
  peerId: string;
  paymentIntentId: string;
  paymentId: string;
  destinationIlpAddress: string;
  amount: bigint;
  assetCode: string;
  assetScale: number;
  expiresAt: string;
}

export class StartRemotePaymentCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.IlpCommands;
  payload: StartRemotePaymentCmdPayload;

  constructor(payload: StartRemotePaymentCmdPayload) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
  }
}
