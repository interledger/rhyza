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

// Published by the peering-client adapter when an outbound prepare receives
// a fulfill response from the peer.
export interface ProcessFulfillPacketCmdPayload {
  peerId: string;
  packetId: string;
  fulfilledAt: string;
}

export class ProcessFulfillPacketCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.IlpCommands;
  payload: ProcessFulfillPacketCmdPayload;

  constructor(payload: ProcessFulfillPacketCmdPayload) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
  }
}

export interface ProcessRejectPacketCmdPayload {
  peerId: string;
  packetId: string;
  rejectCode: string;
  rejectMessage: string;
  rejectedAt: string;
  // Only populated when this reject is destined as a quote response.
  maxSourceAmount?: bigint;
  minDeliveryAmount?: bigint;
  lowEstimatedExchangeRate?: number;
}

export class ProcessRejectPacketCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.IlpCommands;
  payload: ProcessRejectPacketCmdPayload;

  constructor(payload: ProcessRejectPacketCmdPayload) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
  }
}

// Published by the expiry worker when a packet's `expiresAt` passes without
// a terminal response.
export interface ExpirePacketCmdPayload {
  peerId: string;
  packetId: string;
  expiredAt: string;
}

export class ExpirePacketCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.IlpCommands;
  payload: ExpirePacketCmdPayload;

  constructor(payload: ExpirePacketCmdPayload) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
  }
}
