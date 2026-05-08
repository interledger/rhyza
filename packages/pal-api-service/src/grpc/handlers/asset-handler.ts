import { ILogger, IMessageProducer } from 'common-types-lib';
import { AssetAggregate, CreateLedgerAccountForAssetCmd } from 'pal-domain-lib';
import { sendUnaryData, ServerUnaryCall } from '@grpc/grpc-js';
import { Status } from '@grpc/grpc-js/build/src/constants';
import {
  LedgerAccountCreatedForAssetEvent,
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

    if (asset.ledgerAccountId !== null)
      pbAssetResp.setLedgerAccountId(asset.ledgerAccountId);
    if (asset.liquidityLowThreshold !== null)
      pbAssetResp.setLiquidityLowThreshold(Number(asset.liquidityLowThreshold));
    if (asset.liquidityHighThreshold !== null)
      pbAssetResp.setLiquidityHighThreshold(
        Number(asset.liquidityHighThreshold)
      );

    return pbAssetResp;
  }

  async handleCreateAssetRequest(
    call: ServerUnaryCall<PbCreateAssetRequest, PbAsset>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: sendUnaryData<any | undefined>
  ): Promise<void> {
    const lowThreshold = call.request.getLiquidityLowThreshold();
    const highThreshold = call.request.getLiquidityHighThreshold();

    const assetCode = call.request.getCode();

    await this._assetAggregate.createAsset(
      assetCode,
      call.request.getScale(),
      lowThreshold ? BigInt(lowThreshold) : undefined,
      highThreshold ? BigInt(highThreshold) : undefined
    );

    const accountId = crypto.randomUUID();
    const cmd = new CreateLedgerAccountForAssetCmd(assetCode, {
      id: accountId,
      assetCode: assetCode
    });
    cmd.requestId = crypto.randomUUID();
    await this._msgProducer.send(cmd);

    this._responseRegistry.store(cmd.requestId, call, callback);
  }

  async handleLedgerAccountCreatedForAssetEvent(
    pendingResp: PendingResponse,
    event: LedgerAccountCreatedForAssetEvent
  ): Promise<void> {
    const asset = await this._assetAggregate.getAsset(event.payload.assetCode);
    if (!asset) {
      this._responseRegistry.resolve(pendingResp, {
        code: Status.INTERNAL,
        message: 'Could not get asset after creating ledger account'
      });
      return;
    }

    // update the asset with the ledger account id
    await this._assetAggregate.associateLedgerAccount(
      asset.code,
      event.payload.id
    );

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
