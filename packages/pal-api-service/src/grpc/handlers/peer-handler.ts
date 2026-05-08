import { ILogger, IMessageProducer } from 'common-types-lib';
import { sendUnaryData, ServerUnaryCall } from '@grpc/grpc-js';
import { Status } from '@grpc/grpc-js/build/src/constants';
import { PendingResponseRegistry } from '../registries/pending-response-registry';
import {
  CreateLedgerAccountForPeerCmd,
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
  LedgerAccountCreatedForPeerEvent,
  PbDeactivatePeerRequest,
  PbPeer,
  PbGetPeerResponse,
  PbPeerCommsMethod,
  PbGetPeerRequest
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

    if (peer.ledgerAccountId !== null) {
      pbPeer.setLedgerAccountId(peer.ledgerAccountId);
    }
    if (peer.communicationMethod !== null) {
      const pbCommsMethod = new PbPeerCommsMethod();
      pbCommsMethod.setCommsType(peer.communicationMethod.type);
      pbCommsMethod.setStaticAddress(peer.communicationMethod.staticAddress);
      pbPeer.setCommsMethod(pbCommsMethod);
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

    await this._peerAggregate.createPeer(
      peerId,
      call.request.getName(),
      assetCode,
      call.request.getAssetScale()
    );

    const accountId = crypto.randomUUID();
    const cmd = new CreateLedgerAccountForPeerCmd(assetCode, {
      id: accountId,
      assetCode: assetCode,
      peerId: peerId
    });
    cmd.requestId = crypto.randomUUID();
    await this._msgProducer.send(cmd);

    this._responseRegistry.store(cmd.requestId, call, callback);
  }

  async handleLedgerAccountCreatedForPeerEvent(
    pendingResp: PendingResponse,
    event: LedgerAccountCreatedForPeerEvent
  ): Promise<void> {
    const peer = await this._peerAggregate.getPeer(event.payload.peerId);
    if (!peer) {
      this._responseRegistry.resolve(pendingResp, {
        code: Status.INTERNAL,
        message: 'Could not get peer after creating ledger account'
      });
      return;
    }

    // update the asset with the ledger account id
    await this._peerAggregate.associateLedgerAccount(peer.id, event.payload.id);

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
      await this._peerAggregate.setCommunicationMethod(
        call.request.getPeerId(),
        {
          type: commsMethod.getCommsType() as 'ILP',
          staticAddress: commsMethod.getStaticAddress()
        }
      );

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
