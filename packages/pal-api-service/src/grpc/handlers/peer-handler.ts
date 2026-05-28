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
  PeerActivatedEvent
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

  async handlePeerActivatedEvent(
    pendingResp: PendingResponse,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    event: PeerActivatedEvent
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
        this._logger.warn(`Peer with ID ${call.request.getPeerId()} not found`);
        return {
          error: {
            code: Status.NOT_FOUND,
            message: `Peer with ID ${call.request.getPeerId()} not found`
          }
        };
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
        this._logger.warn(`Peer with ID ${peerId} not found`);
        return {
          error: {
            code: Status.NOT_FOUND,
            message: `Peer with ID ${peerId} not found`
          }
        };
      } else if (e instanceof PeerAlreadyActiveError) {
        this._logger.warn(`Peer with ID ${peerId} is already active`);
        return {
          error: {
            code: Status.FAILED_PRECONDITION,
            message: `Peer with ID ${peerId} is already active`
          }
        };
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
        this._logger.warn(`Peer with ID ${peerId} not found`);
        return {
          error: {
            code: Status.NOT_FOUND,
            message: `Peer with ID ${peerId} not found`
          }
        };
      } else if (e instanceof PeerAlreadyInactiveError) {
        this._logger.warn(`Peer with ID ${peerId} is already inactive`);
        return {
          error: {
            code: Status.FAILED_PRECONDITION,
            message: `Peer with ID ${peerId} is already inactive`
          }
        };
      }
    }
  }
}
