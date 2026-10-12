import { CommandMsg, CommandTopics } from 'common-types-lib';
import { PeerHttpConfig } from './peer/interfaces';

const BOUNDED_CONTEXT_NAME = 'ilp';
const AGGREGATE_NAME = 'ilp-peer';

// Published by the Admin API's ILP entry point. Always routed through this
// command (never a direct aggregate call from the API-service process) so
// ilp-command-handler-service remains the single writer of the peer
// repository, regardless of how many API-service instances are running.
export interface CreatePeerCmdPayload {
  peerId: string;
  http: PeerHttpConfig;
  isActive?: boolean;
}

export class CreatePeerCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.IlpCommands;
  payload: CreatePeerCmdPayload;

  constructor(payload: CreatePeerCmdPayload, requestId: string) {
    super(payload.peerId);
    this.requestId = requestId;
    this.msgKey = payload.peerId;
    this.payload = payload;
  }
}

export interface UpdatePeerCmdPayload {
  peerId: string;
  http: PeerHttpConfig;
  isActive?: boolean;
}

export class UpdatePeerCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.IlpCommands;
  payload: UpdatePeerCmdPayload;

  constructor(payload: UpdatePeerCmdPayload, requestId: string) {
    super(payload.peerId);
    this.requestId = requestId;
    this.msgKey = payload.peerId;
    this.payload = payload;
  }
}

// Published by ilp-event-handler-service when it mirrors PAL's
// PeerActivatedEvent/PeerDeactivatedEvent (PAL is the source of truth for
// activation state).
export interface ActivatePeerCmdPayload {
  peerId: string;
}

export class ActivatePeerCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.IlpCommands;
  payload: ActivatePeerCmdPayload;

  constructor(payload: ActivatePeerCmdPayload, requestId: string) {
    super(payload.peerId);
    this.requestId = requestId;
    this.msgKey = payload.peerId;
    this.payload = payload;
  }
}

export interface DeactivatePeerCmdPayload {
  peerId: string;
}

export class DeactivatePeerCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.IlpCommands;
  payload: DeactivatePeerCmdPayload;

  constructor(payload: DeactivatePeerCmdPayload, requestId: string) {
    super(payload.peerId);
    this.requestId = requestId;
    this.msgKey = payload.peerId;
    this.payload = payload;
  }
}

export interface StartRemoteQuoteCmdPayload {
  peerId: string;
  paymentIntentId: string;
  quoteId: string;
  destinationIlpAddress: string;
  sourceAmount: string;
  sourceAssetCode: string;
  sourceAssetScale: number;
  sharedSecret: string;
}

export class StartRemoteQuoteCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.IlpCommands;
  payload: StartRemoteQuoteCmdPayload;

  constructor(payload: StartRemoteQuoteCmdPayload, requestId: string) {
    super(payload.peerId);
    this.requestId = requestId;
    this.msgKey = payload.peerId;
    this.payload = payload;
  }
}

export interface StartRemotePaymentCmdPayload {
  peerId: string;
  paymentIntentId: string;
  paymentId: string;
  destinationIlpAddress: string;
  amount: string;
  assetCode: string;
  assetScale: number;
  expiresAt: string;
  sharedSecret: string;
}

export class StartRemotePaymentCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.IlpCommands;
  payload: StartRemotePaymentCmdPayload;

  constructor(payload: StartRemotePaymentCmdPayload, requestId: string) {
    super(payload.peerId);
    this.requestId = requestId;
    this.msgKey = payload.peerId;
    this.payload = payload;
  }
}

export interface RespondToRemoteQuoteCmdPayload {
  peerId: string;
  packetId: string;
  destinationAmount?: string;
  // Asset `destinationAmount` is denominated in. Sent back as a STREAM
  // ConnectionAssetDetails frame
  destinationAssetCode?: string;
  destinationAssetScale?: number;
}

export class RespondToRemoteQuoteCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.IlpCommands;
  payload: RespondToRemoteQuoteCmdPayload;

  constructor(payload: RespondToRemoteQuoteCmdPayload) {
    super(payload.peerId);
    this.msgKey = payload.packetId;
    this.payload = payload;
  }
}

export interface FulfillInboundPaymentCmdPayload {
  peerId: string;
  packetId: string;
  paymentIntentId: string;
  inboundPaymentId: string;
  requestId: string;
}

// Payments BC: inbound payment is fulfillable - dispatch stored STREAM fulfillment.
export class FulfillInboundPaymentCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.IlpCommands;
  payload: FulfillInboundPaymentCmdPayload;

  constructor(payload: FulfillInboundPaymentCmdPayload) {
    super(payload.peerId);
    this.msgKey = payload.packetId;
    this.payload = payload;
    this.requestId = payload.requestId;
  }
}

export interface RejectInboundPaymentCmdPayload {
  peerId: string;
  packetId: string;
  paymentIntentId: string;
  inboundPaymentId: string;
  requestId: string;
  rejectCode?: string;
  rejectMessage?: string;
}

// Payments BC: inbound payment failed after prepare was accepted — reject on the wire.
export class RejectInboundPaymentCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.IlpCommands;
  payload: RejectInboundPaymentCmdPayload;

  constructor(payload: RejectInboundPaymentCmdPayload) {
    super(payload.peerId);
    this.msgKey = payload.packetId;
    this.payload = payload;
    this.requestId = payload.requestId;
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
  fulfillment: string;
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
  data?: string;
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
  callbackDeadline: string;
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
  callbackDeadline: string;
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
