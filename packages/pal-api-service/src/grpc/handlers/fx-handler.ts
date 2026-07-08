import { ILogger } from 'common-types-lib';
import { ServerUnaryCall } from '@grpc/grpc-js';
import { Status } from '@grpc/grpc-js/build/src/constants';
import { PendingResponseRegistry } from '../registries/pending-response-registry';
import {
  AssetAggregate,
  FxAggregate,
  PeerAggregate,
  PeerNotFoundError
} from 'pal-domain-lib';
import { Empty } from 'google-protobuf/google/protobuf/empty_pb';

import { UnaryResponse } from '../types';
import {
  PbGetFxRateRequest,
  PbGetFxRateResponse,
  PbGetIntraAseFxRateRequest,
  PbGetPeerFxRateToDestinationAssetRequest,
  PbGetPeerFxRateFromSourceAssetRequest,
  PbSetFxRateRequest
} from 'pal-public-types-lib';

/**
 * FX-related request and event handlers
 */
export class FxGrpcHandler {
  private readonly _logger: ILogger;
  private readonly _fxAggregate: FxAggregate;
  private readonly _peerAggregate: PeerAggregate;
  private readonly _assetAggregate: AssetAggregate;
  private readonly _responseRegistry: PendingResponseRegistry;

  constructor(
    fxAggregate: FxAggregate,
    peerAggregate: PeerAggregate,
    assetAggregate: AssetAggregate,
    responseRegistry: PendingResponseRegistry,
    logger: ILogger
  ) {
    this._fxAggregate = fxAggregate;
    this._responseRegistry = responseRegistry;
    this._peerAggregate = peerAggregate;
    this._assetAggregate = assetAggregate;
    this._logger = logger;

    this._logger.info(`${FxGrpcHandler.constructor.name} created`);
  }

  async handleGetFxRateRequest(
    call: ServerUnaryCall<PbGetFxRateRequest, PbGetFxRateResponse>
  ): Promise<UnaryResponse<PbGetFxRateResponse>> {
    let peerId;
    let peerSourceReq: PbGetPeerFxRateFromSourceAssetRequest | undefined;
    let peerDestinationReq:
      | PbGetPeerFxRateToDestinationAssetRequest
      | undefined;
    let intraReq: PbGetIntraAseFxRateRequest | undefined;

    if (call.request.hasFromSourceRequest()) {
      peerSourceReq = call.request.getFromSourceRequest();
    } else if (call.request.hasToDestinationRequest()) {
      peerDestinationReq = call.request.getToDestinationRequest();
    } else if (call.request.hasIntraAseRequest()) {
      intraReq = call.request.getIntraAseRequest();
    }

    if (!peerSourceReq && !peerDestinationReq && !intraReq) {
      throw new Error('Invalid GetFxRateRequest');
    }

    const checkAssetPair = async (assetCodes: string[]) => {
      for (const assetCode of assetCodes) {
        const asset = await this._assetAggregate.getAsset(assetCode);
        if (!asset) {
          throw new Error('Invalid Asset with code: ' + assetCode);
        }
      }
    };

    try {
      let rate: number | null = null;
      if (intraReq) {
        const sourceAssetCode = intraReq.getSourceAssetCode();
        const destinationAssetCode = intraReq.getDestinationAssetCode();
        await checkAssetPair([sourceAssetCode, destinationAssetCode]);
        rate = await this._fxAggregate.getIntraAseFxRate(
          sourceAssetCode,
          destinationAssetCode
        );
      } else {
        peerId = peerSourceReq?.getPeerId() || peerDestinationReq?.getPeerId();
        if (!peerId) {
          this._logger.error('Invalid PeerId in GetFxRateRequest');
          throw new Error('Invalid PeerId in GetFxRateRequest');
        }

        const peer = await this._peerAggregate.getPeer(peerId);
        if (!peer) {
          this._logger.error(
            `could not get peer with id: ${peerId} in GetFxRateRequest`
          );
          throw new PeerNotFoundError();
        }

        const sourceAssetCode = peerSourceReq
          ? peerSourceReq.getSourceAssetCode()
          : peer.assetCode;
        const destinationAssetCode = peerDestinationReq
          ? peerDestinationReq.getDestinationAssetCode()
          : peer.assetCode;

        await checkAssetPair([sourceAssetCode, destinationAssetCode]);

        rate = await this._fxAggregate.getPeerFxRate(
          peerId,
          sourceAssetCode,
          destinationAssetCode
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
    const sourceAssetCode = call.request.getSourceAssetCode();
    const destinationAssetCode = call.request.getDestinationAssetCode();
    const rate = call.request.getRate();
    const peerId = call.request.hasPeerId()
      ? call.request.getPeerId() || null
      : null;
    const rateTtlSecs = call.request.hasRateTtlSecs()
      ? call.request.getRateTtlSecs() || null
      : null;

    // We define the expiration timestamp here, the client proposes
    // the ttl, we do the counting. This avoids clock difference issues.
    const expiresAt = rateTtlSecs ? Date.now() + rateTtlSecs * 1000 : null;

    try {
      if (peerId) {
        const peer = await this._peerAggregate.getPeer(peerId);
        if (!peer) {
          this._logger.error(
            `could not get peer with id: ${peerId} in SetFxRateRequest`
          );
          throw new PeerNotFoundError();
        }

        await this._fxAggregate.setPeerFxRate(
          sourceAssetCode,
          destinationAssetCode,
          peerId,
          rate,
          expiresAt
        );
      } else {
        await this._fxAggregate.setIntraAseFxRate(
          sourceAssetCode,
          destinationAssetCode,
          rate,
          expiresAt
        );
      }

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
