import { ILogger, IMessageProducer } from 'common-types-lib';
import { sendUnaryData, ServerUnaryCall } from '@grpc/grpc-js';
import { Status } from '@grpc/grpc-js/build/src/constants';
import { PendingResponseRegistry } from '../registries/pending-response-registry';
import {
  PalPeer,
  PeerAggregate,
  PeerAlreadyActiveError,
  PeerAlreadyInactiveError,
  PeerNotFoundError
} from 'pal-domain-lib';
import { Empty } from 'google-protobuf/google/protobuf/empty_pb';
import crypto from 'crypto';

import { PendingResponse, UnaryResponse } from '../types';
import {
  PbDeactivatePeerRequest,
  PbPeer,
  PbGetPeerResponse,
  PbGetPeerRequest,
  PbPeerCommsMethodDefinition,
  PbPeerLedgerAccounts,
  PbGetFxRateRequest,
  PbGetFxRateResponse,
  PbGetFxRateFromSourceAssetRequest,
  PbGetFxRateToDestinationAssetRequest,
  PbSetFxRateRequest,
  PeerCreationCompletedEvent
} from 'pal-public-types-lib';
import {
  PbActivatePeerRequest,
  PbCreatePeerRequest,
  PbGetPeerByIlpAddressRequest,
  PbSetPeerCommunicationMethodRequest
} from 'pal-public-types-lib';

/**
 * Peer-related request and event handlers
 */
export class PeerGrpcHandler {
  private readonly _logger: ILogger;
  private readonly _peerAggregate: PeerAggregate;
  private readonly _msgProducer: IMessageProducer;
  private readonly _responseRegistry: PendingResponseRegistry;

  constructor(
    peerAggregate: PeerAggregate,
    responseRegistry: PendingResponseRegistry,
    msgProducer: IMessageProducer,
    logger: ILogger
  ) {
    this._peerAggregate = peerAggregate;
    this._responseRegistry = responseRegistry;
    this._msgProducer = msgProducer;
    this._logger = logger;

    this._logger.info('PeerGrpcHandler created');
  }

  private async _sendUncommittedEvents(requestId?: string): Promise<void> {
    if (this._peerAggregate.uncommittedDomainEvents.length === 0) return;

    if (requestId) {
      // make sure the request id is passed on to any outgoing events
      this._peerAggregate.uncommittedDomainEvents.forEach((evt) => {
        evt.requestId = requestId;
      });
    }

    try {
      await this._msgProducer.send(this._peerAggregate.uncommittedDomainEvents);
    } finally {
      this._peerAggregate.clearUncommittedDomainEvents();
    }
  }

  private _getPbGetPeerResponseFromPeer(
    peer: PalPeer | null
  ): PbGetPeerResponse {
    const resp = new PbGetPeerResponse();

    if (!peer) {
      return resp;
    }

    const pbPeer = new PbPeer();
    pbPeer.setId(peer.id);
    pbPeer.setName(peer.name);
    pbPeer.setAssetCode(peer.assetCode);
    pbPeer.setAssetScale(peer.assetScale);
    pbPeer.setActive(peer.active);

    if (peer.ledgerAccounts !== null) {
      const pbAccounts = new PbPeerLedgerAccounts();
      pbAccounts.setPeerLiquidityAccountId(
        peer.ledgerAccounts.peerLiquidityAccId
      );
      pbAccounts.setPeerClearingAccountId(
        peer.ledgerAccounts.peerClearingAccId
      );
      pbAccounts.setAseLiquidityAccountId(
        peer.ledgerAccounts.aseLiquidityAccId
      );
      pbAccounts.setAseClearingAccountId(peer.ledgerAccounts.aseClearingAccId);
      pbAccounts.setSuspenseAccountId(peer.ledgerAccounts.suspenseAccId);
      pbPeer.setLedgerAccounts(pbAccounts);
    }
    if (peer.communicationMethod !== null) {
      const pbCommsMethod = new PbPeerCommsMethodDefinition();
      pbCommsMethod.setCommsType(peer.communicationMethod.type);
      pbCommsMethod.setStaticAddress(peer.communicationMethod.staticAddress);
      pbPeer.setCommsMethodDefinition(pbCommsMethod);
    }

    resp.setPeer(pbPeer);
    return resp;
  }

  async handleCreatePeerRequest(
    call: ServerUnaryCall<PbCreatePeerRequest, Empty>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: sendUnaryData<any | undefined>
  ): Promise<UnaryResponse<void>> {
    const peerId = call.request.getId();
    const assetCode = call.request.getAssetCode();
    const commsMethod = call.request.getCommsMethodDefinition();
    if (!commsMethod) {
      callback({
        code: Status.INVALID_ARGUMENT,
        message: `Communication method definition is required - trying to create peer id: ${peerId}`
      });
      return;
    }

    await this._peerAggregate.createPeer(
      peerId,
      call.request.getName(),
      assetCode,
      call.request.getAssetScale(),
      {
        type: commsMethod.getCommsType() as 'ILP',
        staticAddress: commsMethod.getStaticAddress()
      }
    );

    if (this._peerAggregate.uncommittedDomainEvents.length == 0) {
      this._logger.warn(
        'No uncommitted domain events after successful peer creation request'
      );
      callback({
        code: Status.UNKNOWN,
        message: `Error processing peer creation request - trying to create peer id: ${peerId}`
      });
      return;
    }

    const requestId = crypto.randomUUID();
    this._responseRegistry.store(requestId, call, callback);

    await this._sendUncommittedEvents(requestId);
  }

  async handlePeerCreationCompletedEvent(
    pendingResp: PendingResponse,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    event: PeerCreationCompletedEvent
  ): Promise<void> {
    // respond to the client
    this._responseRegistry.resolve(pendingResp, null, new Empty());
  }

  async handleGetPeerRequest(
    call: ServerUnaryCall<PbGetPeerRequest, PbGetPeerResponse>
  ): Promise<UnaryResponse<PbGetPeerResponse>> {
    const peer = await this._peerAggregate.getPeer(call.request.getId());
    return { resp: this._getPbGetPeerResponseFromPeer(peer) };
  }

  async handleGetPeerByIlpAddressRequest(
    call: ServerUnaryCall<PbGetPeerByIlpAddressRequest, PbGetPeerResponse>
  ): Promise<UnaryResponse<PbGetPeerResponse>> {
    const peer = await this._peerAggregate.getPeerByIlpAddress(
      call.request.getAddress()
    );
    return { resp: this._getPbGetPeerResponseFromPeer(peer) };
  }

  async handleSetPeerCommunicationMethodRequest(
    call: ServerUnaryCall<PbSetPeerCommunicationMethodRequest, Empty>
  ): Promise<UnaryResponse<Empty>> {
    const commsMethod = call.request.getCommsMethod();
    if (!commsMethod) {
      this._logger.warn(
        'Invalid arguments, no communication method data provided'
      );
      return {
        error: {
          code: Status.INVALID_ARGUMENT,
          message: 'Invalid arguments, no communication method data provided'
        }
      };
    }

    try {
      await this._peerAggregate.setCommunicationMethodDefinition(
        call.request.getPeerId(),
        {
          type: commsMethod.getCommsType() as 'ILP',
          staticAddress: commsMethod.getStaticAddress()
        }
      );
      await this._sendUncommittedEvents();

      return { resp: new Empty() };
    } catch (e) {
      if (e instanceof PeerNotFoundError) {
        const msg = `Peer with ID ${call.request.getPeerId()} not found`;
        this._logger.warn(msg);
        return {
          error: {
            code: Status.NOT_FOUND,
            message: msg
          }
        };
      } else {
        throw e;
      }
    }
  }

  async handleActivatePeerRequest(
    call: ServerUnaryCall<PbActivatePeerRequest, Empty>
  ): Promise<UnaryResponse<Empty>> {
    const peerId = call.request.getPeerId();

    try {
      await this._peerAggregate.activate(peerId);

      await this._sendUncommittedEvents();

      return { resp: new Empty() };
    } catch (e) {
      if (e instanceof PeerNotFoundError) {
        const msg = `Peer with ID ${peerId} not found`;
        this._logger.warn(msg);
        return {
          error: {
            code: Status.NOT_FOUND,
            message: msg
          }
        };
      } else if (e instanceof PeerAlreadyActiveError) {
        const msg = `Peer with ID ${peerId} is already active`;
        this._logger.warn(msg);
        return {
          error: {
            code: Status.FAILED_PRECONDITION,
            message: msg
          }
        };
      } else {
        throw e;
      }
    }
  }

  async handleDeactivatePeerRequest(
    call: ServerUnaryCall<PbDeactivatePeerRequest, Empty>
  ): Promise<UnaryResponse<Empty>> {
    const peerId = call.request.getPeerId();

    try {
      await this._peerAggregate.deactivate(peerId);

      await this._sendUncommittedEvents();

      return { resp: new Empty() };
    } catch (e) {
      if (e instanceof PeerNotFoundError) {
        const msg = `Peer with ID ${peerId} not found`;
        this._logger.warn(msg);
        return {
          error: {
            code: Status.NOT_FOUND,
            message: msg
          }
        };
      } else if (e instanceof PeerAlreadyInactiveError) {
        const msg = `Peer with ID ${peerId} is already inactive`;
        this._logger.warn(msg);
        return {
          error: {
            code: Status.FAILED_PRECONDITION,
            message: msg
          }
        };
      } else {
        throw e;
      }
    }
  }

  async handleGetFxRateRequest(
    call: ServerUnaryCall<PbGetFxRateRequest, PbGetFxRateResponse>
  ): Promise<UnaryResponse<PbGetFxRateResponse>> {
    let peerId;
    let sourceReq: PbGetFxRateFromSourceAssetRequest | undefined;
    let destinationReq: PbGetFxRateToDestinationAssetRequest | undefined;

    if (call.request.hasFromSourceRequest()) {
      sourceReq = call.request.getFromSourceRequest();
    } else if (call.request.hasToDestinationRequest()) {
      destinationReq = call.request.getToDestinationRequest();
    }
    if (!sourceReq && !destinationReq) {
      throw new Error('Invalid GetFxRateRequest');
    }

    try {
      let rate: number | null = null;
      if (sourceReq) {
        peerId = sourceReq.getPeerId();
        rate = await this._peerAggregate.getFxFromSourceAsset(
          peerId,
          sourceReq.getSourceAssetCode()
        );
      } else if (destinationReq) {
        peerId = destinationReq.getPeerId();
        rate = await this._peerAggregate.getFxToDestinationAsset(
          peerId,
          destinationReq.getDestinationAssetCode()
        );
      }

      const pbResp = new PbGetFxRateResponse();
      if (rate) pbResp.setRate(rate);
      return { resp: pbResp };
    } catch (e) {
      if (e instanceof PeerNotFoundError) {
        const msg = `Peer with ID ${peerId} not found`;
        this._logger.warn(msg);
        return {
          error: {
            code: Status.NOT_FOUND,
            message: msg
          }
        };
      } else {
        throw e;
      }
    }
  }

  async handleSetFxRateRequest(
    call: ServerUnaryCall<PbSetFxRateRequest, Empty>
  ): Promise<UnaryResponse<Empty>> {
    const peerId = call.request.getPeerId();
    const sourceAssetCode = call.request.getSourceAssetCode();
    const destinationAssetCode = call.request.getDestinationAssetCode();
    const rate = call.request.getRate();
    const rateTtlSecs = call.request.hasRateTtlSecs()
      ? call.request.getRateTtlSecs() || null
      : null;

    // We define the expiration timestamp here, the client proposes
    // the ttl, we do the counting. This avoids clock difference issues.
    const expiresAt = rateTtlSecs ? Date.now() + rateTtlSecs * 1000 : null;

    try {
      await this._peerAggregate.setFxRate(
        peerId,
        sourceAssetCode,
        destinationAssetCode,
        rate,
        expiresAt
      );

      return { resp: new Empty() };
    } catch (e) {
      if (e instanceof PeerNotFoundError) {
        const msg = `Peer with ID ${peerId} not found`;
        this._logger.warn(msg);
        return {
          error: {
            code: Status.NOT_FOUND,
            message: msg
          }
        };
      } else {
        throw e;
      }
    }
  }
}
