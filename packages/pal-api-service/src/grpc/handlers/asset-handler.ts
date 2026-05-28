import { ILogger, IMessageProducer } from 'common-types-lib';
import { AssetAggregate } from 'pal-domain-lib';
import { sendUnaryData, ServerUnaryCall } from '@grpc/grpc-js';
import { Status } from '@grpc/grpc-js/build/src/constants';
import {
  AssetActivatedEvent,
  PbCreateAssetRequest
} from 'pal-public-types-lib';
import { PendingResponseRegistry } from '../registries/pending-response-registry';
import { PendingResponse, UnaryResponse } from '../types';
import {
  IPalAssetDto,
  PbAsset,
  PbGetAssetRequest,
  PbGetAssetResponse
} from 'pal-public-types-lib';
import { Empty } from 'google-protobuf/google/protobuf/empty_pb';
import crypto from 'crypto';

/**
 * Asset related request and event handlers
 */
export class AssetGrpcHandler {
  private readonly _logger: ILogger;
  private readonly _assetAggregate: AssetAggregate;
  private readonly _msgProducer: IMessageProducer;
  private readonly _responseRegistry: PendingResponseRegistry;

  constructor(
    assetAggregate: AssetAggregate,
    responseRegistry: PendingResponseRegistry,
    msgProducer: IMessageProducer,
    logger: ILogger
  ) {
    this._assetAggregate = assetAggregate;
    this._responseRegistry = responseRegistry;
    this._msgProducer = msgProducer;
    this._logger = logger;

    this._logger.info('AssetGrpcHandler created');
  }

  private _createPbAssetFromAsset(asset: IPalAssetDto): PbAsset {
    const pbAssetResp = new PbAsset();
    pbAssetResp.setCode(asset.code);
    pbAssetResp.setScale(asset.scale);

    if (asset.ledgerAccountId !== null) {
      pbAssetResp.setLedgerAccountId(asset.ledgerAccountId);
    }

    return pbAssetResp;
  }

  async handleCreateAssetRequest(
    call: ServerUnaryCall<PbCreateAssetRequest, PbAsset>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: sendUnaryData<any | undefined>
  ): Promise<void> {
    const assetCode = call.request.getCode();

    await this._assetAggregate.createAsset(assetCode, call.request.getScale());

    if (this._assetAggregate.uncommittedDomainEvents.length == 0) {
      this._logger.warn(
        'No uncommitted domain events after successful asset creation request'
      );
      callback({
        code: Status.UNKNOWN,
        message: `Error processing asset creation request - trying to create asset: ${assetCode}`
      });
      return;
    }

    const requestId = crypto.randomUUID();
    // make sure the request id is passed on to any outgoing events
    this._responseRegistry.store(requestId, call, callback);

    this._assetAggregate.uncommittedDomainEvents.forEach((evt) => {
      evt.requestId = requestId;
    });

    try {
      await this._msgProducer.send(
        this._assetAggregate.uncommittedDomainEvents
      );
    } finally {
      this._assetAggregate.clearUncommittedDomainEvents();
    }
  }

  async handleAssetActivatedEvent(
    pendingResp: PendingResponse,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    event: AssetActivatedEvent
  ): Promise<void> {
    // respond to the client
    this._responseRegistry.resolve(pendingResp, null, new Empty());
  }

  async handleGetAssetRequest(
    call: ServerUnaryCall<PbGetAssetRequest, PbGetAssetResponse>
  ): Promise<UnaryResponse<PbGetAssetResponse>> {
    const asset = await this._assetAggregate.getAsset(call.request.getCode());
    const resp = new PbGetAssetResponse();

    if (asset) {
      const pbAsset = this._createPbAssetFromAsset(asset);
      resp.setAsset(pbAsset);
    }

    return { resp: resp };
  }
}
