import { IMessage } from 'common-types-lib';
import { StreamServer, type IncomingMoney } from '@interledger/stream-receiver';
import {
  ActivatePeerCmd,
  CreatePeerCmd,
  DeactivatePeerCmd,
  ExpirePacketCmd,
  FulfillInboundPaymentCmd,
  ProcessFulfillPacketCmd,
  ProcessPreparePacketCmd,
  ProcessRejectPacketCmd,
  RejectInboundPaymentCmd,
  RespondToRemoteQuoteCmd,
  StartRemotePaymentCmd,
  StartRemoteQuoteCmd,
  UpdatePeerCmd
} from '../commands';
import { IPeeringClient, PacketCorrelation } from '../packet';
import { PacketNotFound } from '../packet/errors';
import {
  decodeStreamReply,
  encodeOutgoingStreamPrepare,
  encodeStreamQuoteReply,
  inboundPrepareFrom,
  ResolveStreamCredentials,
  sha256,
  toIlpPrepare
} from '../stream';
import { Peer } from './entity';
import { DuplicatePeer, UnknownPeer } from './errors';
import {
  ILPPeerCreatedEvent,
  ILPPeerCreationFailedEvent,
  ILPPeerUpdatedEvent,
  ILPPeerUpdateFailedEvent,
  ILPQuoteReceivedEvent,
  ILPQuoteFailedEvent,
  ILPPaymentConfirmedEvent,
  ILPPaymentFailedEvent,
  ILPQuoteRequestReceivedEvent,
  ILPPaymentReceivedEvent,
  ILPPaymentFulfillmentSentEvent,
  ILPPaymentFulfillmentFailedEvent,
  ILPPaymentFailureReason
} from './events';
import { IPeer, IPeerRepository } from './interfaces';

// ILP reject codes for inbound prepare / quote / receive-fail paths.
// F05 (wrong condition) is the only code stream-receiver uses for an
// unfulfillable probe, so it is the sole marker of an inbound quote request.
// F99 is the quote response we send back after Payments returns an amount;
// inbound it means the peer closed the connection, which is a refusal and
// must not be mistaken for a probe. T00 is the generic temporary reject
// (inactive peer, quote calc failure, post-accept receive fail). F06 / F03
// are final: bad STREAM credentials / invalid amount. R00 is wire timeout.
const REJECT_CODE_QUOTE_RESPONSE = 'F99';
const REJECT_CODE_WRONG_CONDITION = 'F05';
const REJECT_CODE_INTERNAL = 'T00';
const REJECT_CODE_UNEXPECTED_PAYMENT = 'F06';
const REJECT_CODE_INVALID_AMOUNT = 'F03';
const REJECT_CODE_TRANSFER_TIMED_OUT = 'R00';

function isIncomingMoney(
  reply: IncomingMoney | { code?: string; fulfillment?: Buffer }
): reply is IncomingMoney {
  return typeof (reply as IncomingMoney).accept === 'function';
}

function isFinalRejectCode(rejectCode: string | undefined): boolean {
  return rejectCode?.startsWith('F') === true;
}

function packetHasExpired(expiresAt: Date | string): boolean {
  const deadline =
    expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  return !Number.isFinite(deadline) || deadline <= Date.now();
}

function parseSharedSecret(
  sharedSecret: string | undefined
): Buffer | undefined {
  if (!sharedSecret) {
    return undefined;
  }
  return Buffer.from(sharedSecret, 'base64url');
}

export class IlpPeerAggregate {
  constructor(
    private readonly peerRepo: IPeerRepository,
    private readonly peeringClient: IPeeringClient,
    private readonly resolveStreamCredentials: ResolveStreamCredentials,
    private readonly streamServer: StreamServer
  ) {}

  async createPeer(input: IPeer): Promise<IPeer> {
    const existing = await this.peerRepo.fetchById(input.peerId);
    if (existing) {
      throw new DuplicatePeer(`Peer with id ${input.peerId} already exists`);
    }

    const entity = Peer.create({
      peerId: input.peerId,
      http: input.http,
      isActive: input.isActive
    });

    const stored = entity.toObject();
    await this.peerRepo.store(stored);
    return stored;
  }

  async updatePeer(input: IPeer): Promise<IPeer> {
    const existing = await this.peerRepo.fetchById(input.peerId);
    if (!existing) {
      throw new UnknownPeer(`Peer ${input.peerId} not found`);
    }

    const entity = Peer.create({
      peerId: input.peerId,
      http: input.http,
      isActive: input.isActive
    });

    const stored = entity.toObject();
    await this.peerRepo.update(stored);
    return stored;
  }

  async getPeer(peerId: string): Promise<IPeer | undefined> {
    return this.peerRepo.fetchById(peerId);
  }

  async listPeers(): Promise<IPeer[]> {
    return this.peerRepo.fetchAll();
  }

  private async handleCreatePeerCmd(cmd: CreatePeerCmd): Promise<IMessage[]> {
    try {
      const peer = await this.createPeer({
        peerId: cmd.payload.peerId,
        http: cmd.payload.http,
        isActive: cmd.payload.isActive
      });
      return [
        new ILPPeerCreatedEvent(
          { peerId: peer.peerId, http: peer.http, isActive: peer.isActive },
          cmd.requestId
        )
      ];
    } catch (err) {
      return [
        new ILPPeerCreationFailedEvent(
          {
            peerId: cmd.payload.peerId,
            errorName: (err as Error).constructor.name,
            message: (err as Error).message
          },
          cmd.requestId
        )
      ];
    }
  }

  private async handleUpdatePeerCmd(cmd: UpdatePeerCmd): Promise<IMessage[]> {
    try {
      const peer = await this.updatePeer({
        peerId: cmd.payload.peerId,
        http: cmd.payload.http,
        isActive: cmd.payload.isActive
      });
      return [
        new ILPPeerUpdatedEvent(
          { peerId: peer.peerId, http: peer.http, isActive: peer.isActive },
          cmd.requestId
        )
      ];
    } catch (err) {
      return [
        new ILPPeerUpdateFailedEvent(
          {
            peerId: cmd.payload.peerId,
            errorName: (err as Error).constructor.name,
            message: (err as Error).message
          },
          cmd.requestId
        )
      ];
    }
  }

  // Activation state mirrors PAL (PAL is the source of truth)
  private async setPeerActive(
    peerId: string,
    isActive: boolean,
    requestId: string
  ): Promise<IMessage[]> {
    try {
      const existing = await this.peerRepo.fetchById(peerId);
      if (!existing) {
        throw new UnknownPeer(`Peer ${peerId} not found`);
      }

      const peer = await this.updatePeer({
        peerId: existing.peerId,
        http: existing.http,
        isActive
      });
      return [
        new ILPPeerUpdatedEvent(
          { peerId: peer.peerId, http: peer.http, isActive: peer.isActive },
          requestId
        )
      ];
    } catch (err) {
      return [
        new ILPPeerUpdateFailedEvent(
          {
            peerId,
            errorName: (err as Error).constructor.name,
            message: (err as Error).message
          },
          requestId
        )
      ];
    }
  }

  private async handleActivatePeerCmd(
    cmd: ActivatePeerCmd
  ): Promise<IMessage[]> {
    return this.setPeerActive(cmd.payload.peerId, true, cmd.requestId);
  }

  private async handleDeactivatePeerCmd(
    cmd: DeactivatePeerCmd
  ): Promise<IMessage[]> {
    return this.setPeerActive(cmd.payload.peerId, false, cmd.requestId);
  }

  async handleBatch(cmds: IMessage[]): Promise<{ events: IMessage[] }> {
    const events: IMessage[] = [];

    for (const cmd of cmds) {
      const emitted = await this.handleCommand(cmd);
      events.push(...emitted);
    }

    return { events };
  }

  private async handleCommand(cmd: IMessage): Promise<IMessage[]> {
    switch (cmd.msgName) {
      case CreatePeerCmd.name:
        return this.handleCreatePeerCmd(cmd as CreatePeerCmd);
      case UpdatePeerCmd.name:
        return this.handleUpdatePeerCmd(cmd as UpdatePeerCmd);
      case ActivatePeerCmd.name:
        return this.handleActivatePeerCmd(cmd as ActivatePeerCmd);
      case DeactivatePeerCmd.name:
        return this.handleDeactivatePeerCmd(cmd as DeactivatePeerCmd);
      case StartRemoteQuoteCmd.name:
        return this.handleStartRemoteQuote(cmd as StartRemoteQuoteCmd);
      case StartRemotePaymentCmd.name:
        return this.handleStartRemotePayment(cmd as StartRemotePaymentCmd);
      case ProcessPreparePacketCmd.name:
        return this.handleProcessPreparePacket(cmd as ProcessPreparePacketCmd);
      case RespondToRemoteQuoteCmd.name:
        return this.handleRespondToRemoteQuote(cmd as RespondToRemoteQuoteCmd);
      case FulfillInboundPaymentCmd.name:
        return this.handleFulfillInboundPayment(
          cmd as FulfillInboundPaymentCmd
        );
      case RejectInboundPaymentCmd.name:
        return this.handleRejectInboundPayment(cmd as RejectInboundPaymentCmd);
      case ProcessFulfillPacketCmd.name:
        return this.handleProcessFulfillPacket(cmd as ProcessFulfillPacketCmd);
      case ProcessRejectPacketCmd.name:
        return this.handleProcessRejectPacket(cmd as ProcessRejectPacketCmd);
      case ExpirePacketCmd.name:
        return this.handleExpirePacket(cmd as ExpirePacketCmd);
      default:
        throw new Error(`Unexpected command: ${cmd.msgName}`);
    }
  }

  private async handleStartRemoteQuote(
    cmd: StartRemoteQuoteCmd
  ): Promise<IMessage[]> {
    const payload = cmd.payload;
    const peer = await this.peerRepo.fetchById(payload.peerId);
    if (!peer) {
      return [
        new ILPQuoteFailedEvent(
          {
            peerId: payload.peerId,
            paymentIntentId: payload.paymentIntentId,
            quoteId: payload.quoteId,
            rejectMessage: `Peer ${payload.peerId} not found`
          },
          cmd.requestId
        )
      ];
    }

    const sharedSecret = parseSharedSecret(payload.sharedSecret);
    if (!sharedSecret) {
      return [
        new ILPQuoteFailedEvent(
          {
            peerId: payload.peerId,
            paymentIntentId: payload.paymentIntentId,
            quoteId: payload.quoteId,
            rejectMessage: 'missing STREAM shared secret'
          },
          cmd.requestId
        )
      ];
    }

    const packetId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30_000);
    // A probe cannot be fulfilled, so it asserts no minimum: we are asking
    // what arrives, not demanding a floor. Anything else risks the receiver
    // answering F04 (insufficient destination amount) instead of telling us
    // the rate.
    const encoded = encodeOutgoingStreamPrepare({
      sharedSecret,
      minDestinationAmount: '0'
    });

    const correlation = PacketCorrelation.createQuote({
      packetId,
      peerId: peer.peerId,
      paymentIntentId: payload.paymentIntentId,
      expiresAt,
      quoteId: payload.quoteId,
      requestId: cmd.requestId,
      sharedSecret: payload.sharedSecret
    });
    await this.peerRepo.storePacket(correlation.toObject());

    await this.peeringClient.dispatch({
      type: 'QUOTE',
      peerId: peer.peerId,
      packetId,
      paymentIntentId: payload.paymentIntentId,
      quoteId: payload.quoteId,
      destinationIlpAddress: payload.destinationIlpAddress,
      sourceAmount: payload.sourceAmount,
      sourceAssetCode: payload.sourceAssetCode,
      sourceAssetScale: payload.sourceAssetScale,
      expiresAt: expiresAt.toISOString(),
      data: encoded.data.toString('base64')
    });

    return [];
  }

  private async handleStartRemotePayment(
    cmd: StartRemotePaymentCmd
  ): Promise<IMessage[]> {
    const payload = cmd.payload;
    const peer = await this.peerRepo.fetchById(payload.peerId);
    if (!peer) {
      return [
        new ILPPaymentFailedEvent(
          {
            peerId: payload.peerId,
            paymentIntentId: payload.paymentIntentId,
            paymentId: payload.paymentId,
            failedAt: new Date().toISOString(),
            reason: ILPPaymentFailureReason.REJECTED,
            rejectMessage: `Peer ${payload.peerId} not found`
          },
          cmd.requestId
        )
      ];
    }

    const sharedSecret = parseSharedSecret(payload.sharedSecret);
    if (!sharedSecret) {
      return [
        new ILPPaymentFailedEvent(
          {
            peerId: payload.peerId,
            paymentIntentId: payload.paymentIntentId,
            paymentId: payload.paymentId,
            failedAt: new Date().toISOString(),
            reason: ILPPaymentFailureReason.REJECTED,
            rejectMessage: 'missing STREAM shared secret'
          },
          cmd.requestId
        )
      ];
    }

    const packetId = crypto.randomUUID();
    // Both sides of a direct peer link settle in the same peering asset, so
    // the amount we send is the amount that arrives and doubles as the floor.
    // That equality breaks the moment a hop applies FX — a multi-hop path or
    // slippage policy has to supply a real minimum here instead.
    const encoded = encodeOutgoingStreamPrepare({
      sharedSecret,
      minDestinationAmount: payload.amount
    });

    const correlation = PacketCorrelation.createPayment({
      packetId,
      peerId: peer.peerId,
      paymentIntentId: payload.paymentIntentId,
      expiresAt: new Date(payload.expiresAt),
      paymentId: payload.paymentId,
      requestId: cmd.requestId,
      executionCondition: encoded.executionCondition.toString('base64')
    });
    await this.peerRepo.storePacket(correlation.toObject());

    await this.peeringClient.dispatch({
      type: 'PAYMENT',
      peerId: peer.peerId,
      packetId,
      paymentIntentId: payload.paymentIntentId,
      paymentId: payload.paymentId,
      destinationIlpAddress: payload.destinationIlpAddress,
      amount: payload.amount,
      assetCode: payload.assetCode,
      assetScale: payload.assetScale,
      expiresAt: payload.expiresAt,
      sharedSecret: payload.sharedSecret,
      executionCondition: encoded.executionCondition.toString('base64'),
      data: encoded.data.toString('base64')
    });

    return [];
  }

  private async handleProcessPreparePacket(
    cmd: ProcessPreparePacketCmd
  ): Promise<IMessage[]> {
    const payload = cmd.payload;

    if (packetHasExpired(payload.expiresAt)) {
      await this.rejectInbound(payload, REJECT_CODE_TRANSFER_TIMED_OUT);
      return [];
    }

    const peer = await this.peerRepo.fetchById(payload.peerId);
    if (!peer || peer.isActive === false) {
      await this.rejectInbound(payload, REJECT_CODE_INTERNAL);
      return [];
    }

    const resolved = await this.resolveStreamCredentials(
      payload.destinationIlpAddress
    );
    if (!resolved) {
      await this.rejectInbound(payload, REJECT_CODE_UNEXPECTED_PAYMENT);
      return [];
    }

    if (!/^\d+$/.test(payload.amount)) {
      await this.rejectInbound(payload, REJECT_CODE_INVALID_AMOUNT);
      return [];
    }

    const inboundPrepare = inboundPrepareFrom(payload);
    const streamReply = this.streamServer.createReply(
      toIlpPrepare(inboundPrepare)
    );

    if (isIncomingMoney(streamReply)) {
      // resolveStreamCredentials and StreamServer derive the payment tag from
      // the same address by separate code paths. If they ever disagree the
      // packet would be credited to the wrong intent, so refuse it instead.
      if (
        streamReply.paymentTag !== undefined &&
        streamReply.paymentTag !== resolved.paymentIntentId
      ) {
        await this.rejectInbound(payload, REJECT_CODE_UNEXPECTED_PAYMENT);
        return [];
      }

      const paymentId = crypto.randomUUID();
      const requestId = cmd.requestId ?? crypto.randomUUID();
      const correlation = PacketCorrelation.createPayment({
        packetId: payload.packetId,
        peerId: peer.peerId,
        paymentIntentId: resolved.paymentIntentId,
        expiresAt: new Date(payload.expiresAt),
        paymentId,
        requestId,
        inboundPrepare
      });
      await this.peerRepo.storePacket(correlation.toObject());
      return [
        new ILPPaymentReceivedEvent({
          peerId: peer.peerId,
          packetId: payload.packetId,
          paymentIntentId: resolved.paymentIntentId,
          paymentId,
          sourceAmount: payload.amount,
          requestId,
          expiresAt: payload.expiresAt
        })
      ];
    }

    // Zero-amount connection probe with a valid condition: stream-receiver
    // fulfills it outright. No money moves, so Payments never hears about it.
    if ('fulfillment' in streamReply) {
      await this.peeringClient.dispatchFulfill({
        peerId: payload.peerId,
        packetId: payload.packetId,
        callbackDeadline: payload.expiresAt,
        fulfillment: streamReply.fulfillment.toString('base64'),
        data: streamReply.data.toString('base64')
      });
      return [];
    }

    // Everything except F05 is a genuine refusal — F02/F06/F00 for a packet we
    // cannot attribute, F04 for a short delivery, F99 for a peer closing the
    // connection. Echo the reply stream-receiver already built rather than
    // dragging it through the quote flow.
    if (streamReply.code !== REJECT_CODE_WRONG_CONDITION) {
      await this.rejectInbound(
        payload,
        streamReply.code,
        streamReply.data.length
          ? streamReply.data.toString('base64')
          : undefined
      );
      return [];
    }

    const correlation = PacketCorrelation.createQuote({
      packetId: payload.packetId,
      peerId: peer.peerId,
      paymentIntentId: resolved.paymentIntentId,
      expiresAt: new Date(payload.expiresAt),
      // Inbound quotes have no Payments quote id and packetId is unique per probe.
      quoteId: payload.packetId,
      requestId: cmd.requestId ?? crypto.randomUUID(),
      inboundPrepare
    });
    await this.peerRepo.storePacket(correlation.toObject());

    return [
      new ILPQuoteRequestReceivedEvent({
        peerId: peer.peerId,
        packetId: payload.packetId,
        paymentIntentId: resolved.paymentIntentId,
        incomingAmount: payload.amount,
        expiresAt: payload.expiresAt
      })
    ];
  }

  private async handleRespondToRemoteQuote(
    cmd: RespondToRemoteQuoteCmd
  ): Promise<IMessage[]> {
    const payload = cmd.payload;
    const stored = await this.peerRepo.fetchPacketById(payload.packetId);
    if (!stored?.inboundPrepare) {
      return [];
    }

    const inboundPrepare = stored.inboundPrepare;
    if (payload.destinationAmount === undefined) {
      await this.rejectInbound(stored, REJECT_CODE_INTERNAL);
      return [];
    }

    const resolved = await this.resolveStreamCredentials(
      inboundPrepare.destinationIlpAddress
    );
    if (!resolved) {
      await this.rejectInbound(stored, REJECT_CODE_INTERNAL);
      return [];
    }

    const data = encodeStreamQuoteReply({
      sharedSecret: resolved.sharedSecret,
      prepareData: Buffer.from(inboundPrepare.data, 'base64'),
      prepareAmount: payload.destinationAmount,
      assetCode: payload.destinationAssetCode,
      assetScale: payload.destinationAssetScale
    });
    if (!data) {
      await this.rejectInbound(stored, REJECT_CODE_INTERNAL);
      return [];
    }

    await this.peeringClient.dispatchReject({
      peerId: payload.peerId,
      packetId: payload.packetId,
      callbackDeadline: inboundPrepare.expiresAt,
      rejectCode: REJECT_CODE_QUOTE_RESPONSE,
      data: data.toString('base64')
    });
    if (stored.state === 'PENDING') {
      await this.peerRepo.updatePacket(
        PacketCorrelation.fromObject(stored).reject().toObject()
      );
    }
    return [];
  }

  private async handleFulfillInboundPayment(
    cmd: FulfillInboundPaymentCmd
  ): Promise<IMessage[]> {
    const payload = cmd.payload;
    const failedAt = new Date().toISOString();
    const fail = (reason: string, paymentId: string) => [
      new ILPPaymentFulfillmentFailedEvent({
        peerId: payload.peerId,
        packetId: payload.packetId,
        paymentIntentId: payload.paymentIntentId,
        paymentId,
        inboundPaymentId: payload.inboundPaymentId,
        failedAt,
        reason,
        requestId: payload.requestId
      })
    ];

    const stored = await this.peerRepo.fetchPacketById(payload.packetId);
    if (!stored || stored.kind !== 'PAYMENT') {
      return fail('packet_not_found', payload.inboundPaymentId);
    }

    if (stored.state !== 'PENDING') {
      return fail(`packet_${stored.state.toLowerCase()}`, stored.paymentId);
    }

    if (!stored.inboundPrepare) {
      return fail('prepare_snapshot_missing', stored.paymentId);
    }

    const streamReply = this.streamServer.createReply(
      toIlpPrepare(stored.inboundPrepare)
    );
    if (!isIncomingMoney(streamReply)) {
      return fail('not_fulfillable', stored.paymentId);
    }

    // One packet per payment, so this packet's amount is the connection total.
    // Revisit alongside any decision to accept split inbound delivery.
    streamReply.setTotalReceived(stored.inboundPrepare.amount);
    const fulfill = streamReply.accept();

    try {
      await this.peeringClient.dispatchFulfill({
        peerId: payload.peerId,
        packetId: payload.packetId,
        callbackDeadline: stored.inboundPrepare.expiresAt,
        fulfillment: fulfill.fulfillment.toString('base64'),
        data: fulfill.data.toString('base64')
      });
    } catch (err) {
      return fail(
        err instanceof Error ? err.message : 'dispatch_failed',
        stored.paymentId
      );
    }

    const fulfilled = PacketCorrelation.fromObject(stored).fulfill().toObject();
    await this.peerRepo.updatePacket(fulfilled);

    return [
      new ILPPaymentFulfillmentSentEvent({
        peerId: payload.peerId,
        packetId: payload.packetId,
        paymentIntentId: payload.paymentIntentId,
        paymentId: stored.paymentId,
        inboundPaymentId: payload.inboundPaymentId,
        fulfilledAt: new Date().toISOString(),
        requestId: payload.requestId
      })
    ];
  }

  private async handleRejectInboundPayment(
    cmd: RejectInboundPaymentCmd
  ): Promise<IMessage[]> {
    const payload = cmd.payload;
    const stored = await this.peerRepo.fetchPacketById(payload.packetId);
    if (!stored?.inboundPrepare) {
      return [];
    }

    if (stored.state === 'PENDING') {
      const rejected = PacketCorrelation.fromObject(stored).reject().toObject();
      await this.peerRepo.updatePacket(rejected);
    }

    const rejectCode = payload.rejectCode ?? REJECT_CODE_INTERNAL;
    const inboundPrepare = stored.inboundPrepare;
    const streamReply = this.streamServer.createReply(
      toIlpPrepare(inboundPrepare)
    );
    if (isIncomingMoney(streamReply)) {
      // Take the STREAM framing from the library — finalDecline adds the
      // ConnectionClose frame that tells the sender not to retry — but keep
      // the reject code Payments chose. temporaryDecline/finalDecline are
      // hardcoded to T00/F99, and collapsing every failure into one of those
      // loses why the payment was refused.
      const reply = isFinalRejectCode(rejectCode)
        ? streamReply.finalDecline()
        : streamReply.temporaryDecline();
      await this.rejectInbound(
        stored,
        rejectCode,
        reply.data.toString('base64')
      );
      return [];
    }

    await this.rejectInbound(stored, rejectCode);
    return [];
  }

  private async rejectInbound(
    context: {
      peerId: string;
      packetId: string;
      expiresAt: Date | string;
    },
    rejectCode: string = REJECT_CODE_INTERNAL,
    data?: string
  ): Promise<void> {
    const callbackDeadline =
      context.expiresAt instanceof Date
        ? context.expiresAt.toISOString()
        : context.expiresAt;
    await this.peeringClient.dispatchReject({
      peerId: context.peerId,
      packetId: context.packetId,
      callbackDeadline,
      rejectCode,
      data
    });
  }

  private async handleProcessFulfillPacket(
    cmd: ProcessFulfillPacketCmd
  ): Promise<IMessage[]> {
    const payload = cmd.payload;
    const stored = await this.peerRepo.fetchPacketById(payload.packetId);
    if (!stored) {
      throw new PacketNotFound(`Packet ${payload.packetId} not found`);
    }

    if (stored.kind === 'PAYMENT') {
      if (packetHasExpired(stored.expiresAt)) {
        const expired = PacketCorrelation.fromObject(stored)
          .expire()
          .toObject();
        await this.peerRepo.updatePacket(expired);
        return [
          new ILPPaymentFailedEvent(
            {
              peerId: stored.peerId,
              paymentIntentId: stored.paymentIntentId,
              paymentId: stored.paymentId,
              failedAt: payload.fulfilledAt,
              reason: 'EXPIRED'
            },
            stored.requestId
          )
        ];
      }

      const fulfillment = payload.fulfillment
        ? Buffer.from(payload.fulfillment, 'base64')
        : Buffer.alloc(0);
      const condition = stored.executionCondition
        ? Buffer.from(stored.executionCondition, 'base64')
        : Buffer.alloc(0);
      const hashMatches =
        fulfillment.length > 0 &&
        condition.length > 0 &&
        sha256(fulfillment).equals(condition);

      if (!hashMatches) {
        const rejected = PacketCorrelation.fromObject(stored)
          .reject()
          .toObject();
        await this.peerRepo.updatePacket(rejected);
        return [
          new ILPPaymentFailedEvent(
            {
              peerId: stored.peerId,
              paymentIntentId: stored.paymentIntentId,
              paymentId: stored.paymentId,
              failedAt: payload.fulfilledAt,
              reason: 'REJECTED'
            },
            stored.requestId
          )
        ];
      }
    }

    const transitioned = PacketCorrelation.fromObject(stored)
      .fulfill()
      .toObject();
    await this.peerRepo.updatePacket(transitioned);

    if (transitioned.kind === 'PAYMENT') {
      return [
        new ILPPaymentConfirmedEvent(
          {
            peerId: transitioned.peerId,
            paymentIntentId: transitioned.paymentIntentId,
            paymentId: transitioned.paymentId,
            confirmedAt: payload.fulfilledAt
          },
          transitioned.requestId
        )
      ];
    }

    // Quote probes don't fulfill
    return [];
  }

  private async handleProcessRejectPacket(
    cmd: ProcessRejectPacketCmd
  ): Promise<IMessage[]> {
    const payload = cmd.payload;
    const stored = await this.peerRepo.fetchPacketById(payload.packetId);
    if (!stored) {
      throw new PacketNotFound(`Packet ${payload.packetId} not found`);
    }
    // Read before transitioning: going terminal drops the secret so it isn't
    // left at rest in the correlation.
    const quoteSecret =
      stored.kind === 'QUOTE' ? stored.sharedSecret : undefined;

    const transitioned = PacketCorrelation.fromObject(stored)
      .reject()
      .toObject();
    await this.peerRepo.updatePacket(transitioned);

    if (transitioned.kind === 'QUOTE') {
      const streamReply =
        payload.data && quoteSecret
          ? decodeStreamReply(
              Buffer.from(quoteSecret, 'base64url'),
              Buffer.from(payload.data, 'base64')
            )
          : undefined;
      // Decrypting under our secret proves the receiver sent it, but not that
      // it is an answer. A transient reject means "ask again" and a
      // ConnectionClose means the receiver refused.
      // Neither carries a rate
      const destinationAmount =
        streamReply &&
        !streamReply.connectionClosed &&
        isFinalRejectCode(payload.rejectCode)
          ? streamReply.prepareAmount
          : undefined;
      if (destinationAmount !== undefined) {
        return [
          new ILPQuoteReceivedEvent(
            {
              peerId: transitioned.peerId,
              paymentIntentId: transitioned.paymentIntentId,
              quoteId: transitioned.quoteId,
              destinationAmount
            },
            transitioned.requestId
          )
        ];
      }

      return [
        new ILPQuoteFailedEvent(
          {
            peerId: transitioned.peerId,
            paymentIntentId: transitioned.paymentIntentId,
            quoteId: transitioned.quoteId,
            rejectCode: payload.rejectCode,
            rejectMessage: payload.rejectMessage,
            expired: payload.rejectCode === REJECT_CODE_TRANSFER_TIMED_OUT
          },
          transitioned.requestId
        )
      ];
    }

    return [
      new ILPPaymentFailedEvent(
        {
          peerId: transitioned.peerId,
          paymentIntentId: transitioned.paymentIntentId,
          paymentId: transitioned.paymentId,
          failedAt: payload.rejectedAt,
          reason:
            payload.rejectCode === REJECT_CODE_TRANSFER_TIMED_OUT
              ? 'EXPIRED'
              : 'REJECTED',
          rejectCode: payload.rejectCode,
          rejectMessage: payload.rejectMessage
        },
        transitioned.requestId
      )
    ];
  }

  private async handleExpirePacket(cmd: ExpirePacketCmd): Promise<IMessage[]> {
    const payload = cmd.payload;
    const stored = await this.peerRepo.fetchPacketById(payload.packetId);
    if (!stored) {
      throw new PacketNotFound(`Packet ${payload.packetId} not found`);
    }
    const transitioned = PacketCorrelation.fromObject(stored)
      .expire()
      .toObject();
    await this.peerRepo.updatePacket(transitioned);
    if (transitioned.kind === 'QUOTE' && transitioned.inboundPrepare) {
      // Inbound quote
      return [];
    }

    if (transitioned.kind === 'QUOTE') {
      return [
        new ILPQuoteFailedEvent(
          {
            peerId: transitioned.peerId,
            paymentIntentId: transitioned.paymentIntentId,
            quoteId: transitioned.quoteId,
            expired: true
          },
          transitioned.requestId
        )
      ];
    }

    return [
      new ILPPaymentFailedEvent(
        {
          peerId: transitioned.peerId,
          paymentIntentId: transitioned.paymentIntentId,
          paymentId: transitioned.paymentId,
          failedAt: payload.expiredAt,
          reason: 'EXPIRED'
        },
        transitioned.requestId
      )
    ];
  }
}
