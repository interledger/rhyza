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

export interface ProcessPreparePacketCmdPayload {
  peerId: string;
  packetId: string;
  destinationIlpAddress: string;
  amount: string;
  expiresAt: string;
  // base64-encoded 32-byte execution condition.
  executionCondition: string;
  // base64-encoded ILP packet data (opaque STREAM payload) - decoded by the
  // aggregate, never by the connector.
  data?: string;
}

export class ProcessPreparePacketCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.IlpCommands;
  payload: ProcessPreparePacketCmdPayload;

  constructor(payload: ProcessPreparePacketCmdPayload) {
    super(payload.peerId);
    this.msgKey = payload.packetId;
    this.payload = payload;
  }
}

export interface ProcessFulfillPacketCmdPayload {
  peerId: string;
  paymentIntentId: string;
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
    this.msgKey = payload.paymentIntentId;
    this.payload = payload;
  }
}

export interface ProcessRejectPacketCmdPayload {
  peerId: string;
  paymentIntentId: string;
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
    this.msgKey = payload.paymentIntentId;
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

export interface DispatchPreparePacketCmdPayload {
  peerId: string;
  packetId: string;
  paymentIntentId: string;
  destinationIlpAddress: string;
  amount: string;
  expiresAt: string;
  executionCondition: string;
  data?: string;
}

export class DispatchPreparePacketCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.IlpConnectorCommands;
  payload: DispatchPreparePacketCmdPayload;

  constructor(payload: DispatchPreparePacketCmdPayload) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
  }
}

export interface DispatchFulfillPacketCmdPayload {
  peerId: string;
  packetId: string;
  fulfillment: string;
  data?: string;
}

export class DispatchFulfillPacketCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.IlpConnectorCommands;
  payload: DispatchFulfillPacketCmdPayload;

  constructor(payload: DispatchFulfillPacketCmdPayload) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
  }
}

export interface DispatchRejectPacketCmdPayload {
  peerId: string;
  packetId: string;
  rejectCode: string;
  rejectMessage?: string;
  triggeredBy?: string;
  data?: string;
}

export class DispatchRejectPacketCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.IlpConnectorCommands;
  payload: DispatchRejectPacketCmdPayload;

  constructor(payload: DispatchRejectPacketCmdPayload) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
  }
}
