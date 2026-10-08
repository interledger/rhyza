import { ILogger, ITelemetryService } from 'common-types-lib';
import {
  AssetAggregate,
  InvalidWalletAddressJwkError,
  WalletAddressAggregate,
  WalletAddressAlreadyActiveError,
  WalletAddressAlreadyInactiveError,
  WalletAddressNotFoundError
} from 'pal-domain-lib';
import { ServerUnaryCall } from '@grpc/grpc-js';
import { Status } from '@grpc/grpc-js/build/src/constants';
import { UnaryResponse } from '../types';
import { Empty } from 'google-protobuf/google/protobuf/empty_pb';

import {
  jsonWebKeyFromPb,
  PbAddWalletAddressKeyRequest,
  PbAddWalletAddressKeyResponse,
  PbActivateWalletAddressRequest,
  PbCreateWalletAddressAliasRequest,
  PbDeactivateWalletAddressRequest,
  PbCreateWalletAddressRequest,
  PbCreateWalletAddressResponse,
  PbGetWalletAddressKeysRequest,
  PbGetWalletAddressKeysResponse,
  PbRevokeWalletAddressKeyRequest,
  PbGetWalletAddressesRequest,
  PbGetWalletAddressesResponse,
  PbResolveWalletAddressAliasRequest,
  PbResolveWalletAddressAliasResponse,
  PbResolveWalletAddressNonEmptyResponse,
  PbSingleWalletAddressResponse,
  walletAddressKeyToPb
} from 'pal-public-types-lib';

/**
 * WalletAddress related request and event handlers
 */
export class WalletAddressGrpcHandler {
  private readonly _logger: ILogger;
  private readonly _walletAddressAggregate: WalletAddressAggregate;
  private readonly _assetAggregate: AssetAggregate;
  private readonly _telemetryService: ITelemetryService;

  constructor(
    walletAddressAggregate: WalletAddressAggregate,
    assetAggregate: AssetAggregate,
    logger: ILogger,
    telemetryService: ITelemetryService
  ) {
    this._walletAddressAggregate = walletAddressAggregate;
    this._assetAggregate = assetAggregate;
    this._logger = logger.child(this.constructor.name);
    this._telemetryService = telemetryService;

    this._logger.info('WalletAddressGrpcHandler created');
  }

  async handleCreateWalletAddressRequest(
    call: ServerUnaryCall<
      PbCreateWalletAddressRequest,
      PbCreateWalletAddressResponse
    >
  ): Promise<UnaryResponse<PbCreateWalletAddressResponse>> {
    const asset = await this._assetAggregate.getAsset(
      call.request.getAssetCode()
    );

    if (!asset) {
      this._logger.warn(`Asset ${call.request.getAssetCode()} does not exist`);
      return {
        error: {
          code: Status.NOT_FOUND,
          message: `Asset ${call.request.getAssetCode()} does not exist`
        }
      };
    }

    const isActive =
      !call.request.hasIsActive() || call.request.getIsActive() == true;

    const domain = call.request.hasDomain()
      ? call.request.getDomain() || null
      : null;

    const id = await this._walletAddressAggregate.createWalletAddress(
      domain,
      call.request.getPathName(),
      call.request.getPublicName(),
      asset.code,
      asset.scale,
      isActive
    );

    const response = new PbCreateWalletAddressResponse()
      .setId(id)
      .setPathName(call.request.getPathName())
      .setPublicName(call.request.getPublicName())
      .setAssetCode(asset.code)
      .setAssetScale(asset.scale)
      .setIsActive(isActive);

    if (domain) {
      response.setDomain(domain);
    }

    return { resp: response };
  }

  async handleGetWalletAddressesRequest(
    call: ServerUnaryCall<
      PbGetWalletAddressesRequest,
      PbGetWalletAddressesResponse
    >
  ): Promise<UnaryResponse<PbGetWalletAddressesResponse>> {
    const wallets = await this._walletAddressAggregate.getWalletAddresses(
      call.request.getIdsList()
    );
    const resp = new PbGetWalletAddressesResponse();

    const walletList = wallets.map((item) => {
      const wallet = new PbSingleWalletAddressResponse();
      wallet.setId(item.id);
      wallet.setPublicName(item.publicName);
      wallet.setAssetCode(item.assetCode);
      wallet.setAssetScale(item.assetScale);
      wallet.setIsActive(item.isActive);
      return wallet;
    });

    resp.setWalletAddressesList(walletList);

    return { resp: resp };
  }

  async handleResolveWalletAddressAliasRequest(
    call: ServerUnaryCall<
      PbResolveWalletAddressAliasRequest,
      PbResolveWalletAddressAliasResponse
    >
  ): Promise<UnaryResponse<PbResolveWalletAddressAliasResponse>> {
    const domain = call.request.hasDomain()
      ? call.request.getDomain() || null
      : null;
    const pathName = call.request.getPathName();

    const walletAddressId =
      await this._walletAddressAggregate.resolveWalletAddressAlias(
        domain,
        pathName
      );

    const resp = new PbResolveWalletAddressAliasResponse();

    if (walletAddressId == null) {
      return { resp: resp };
    }

    const aliasResp = new PbResolveWalletAddressNonEmptyResponse();
    if (domain) aliasResp.setDomain(domain);
    aliasResp.setPathName(pathName);
    aliasResp.setWalletAddressId(walletAddressId);

    resp.setAlias(aliasResp);
    return { resp: resp };
  }

  async handleCreateWalletAddressAliasRequest(
    call: ServerUnaryCall<PbCreateWalletAddressAliasRequest, Empty>
  ): Promise<UnaryResponse<Empty>> {
    const domain = call.request.hasDomain()
      ? call.request.getDomain() || null
      : null;

    // Use the wallet domain service to coordinate wallet address and wallet alias aggregates
    await this._walletAddressAggregate.createWalletAddressAlias(
      domain,
      call.request.getPathName(),
      call.request.getWalletAddressId()
    );

    return { resp: new Empty() };
  }

  async handleActivateWalletAddressRequest(
    call: ServerUnaryCall<PbActivateWalletAddressRequest, Empty>
  ): Promise<UnaryResponse<Empty>> {
    const walletAddressId = call.request.getWalletAddressId();

    try {
      await this._walletAddressAggregate.activate(walletAddressId);
      return { resp: new Empty() };
    } catch (e) {
      if (e instanceof WalletAddressNotFoundError) {
        const msg = `Wallet address with ID ${walletAddressId} not found`;
        this._logger.warn(msg);
        return {
          error: {
            code: Status.NOT_FOUND,
            message: msg
          }
        };
      } else if (e instanceof WalletAddressAlreadyActiveError) {
        const msg = `Wallet address with ID ${walletAddressId} is already active`;
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

  async handleDeactivateWalletAddressRequest(
    call: ServerUnaryCall<PbDeactivateWalletAddressRequest, Empty>
  ): Promise<UnaryResponse<Empty>> {
    const walletAddressId = call.request.getWalletAddressId();

    try {
      await this._walletAddressAggregate.deactivate(walletAddressId);
      return { resp: new Empty() };
    } catch (e) {
      if (e instanceof WalletAddressNotFoundError) {
        const msg = `Wallet address with ID ${walletAddressId} not found`;
        this._logger.warn(msg);
        return {
          error: {
            code: Status.NOT_FOUND,
            message: msg
          }
        };
      } else if (e instanceof WalletAddressAlreadyInactiveError) {
        const msg = `Wallet address with ID ${walletAddressId} is already inactive`;
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

  async handleAddWalletAddressKeyRequest(
    call: ServerUnaryCall<
      PbAddWalletAddressKeyRequest,
      PbAddWalletAddressKeyResponse
    >
  ): Promise<UnaryResponse<PbAddWalletAddressKeyResponse>> {
    const pbJwk = call.request.getJwk();
    if (!call.request.hasJwk() || !pbJwk) {
      throw new InvalidWalletAddressJwkError('JWK is required');
    }

    const id = await this._walletAddressAggregate.addWalletAddressKey(
      call.request.getWalletAddressId(),
      jsonWebKeyFromPb(pbJwk)
    );

    return { resp: new PbAddWalletAddressKeyResponse().setId(id) };
  }

  async handleGetWalletAddressKeysRequest(
    call: ServerUnaryCall<
      PbGetWalletAddressKeysRequest,
      PbGetWalletAddressKeysResponse
    >
  ): Promise<UnaryResponse<PbGetWalletAddressKeysResponse>> {
    const keys = await this._walletAddressAggregate.getWalletAddressKeys(
      call.request.getWalletAddressId()
    );

    const resp = new PbGetWalletAddressKeysResponse();
    resp.setKeysList(keys.map(walletAddressKeyToPb));
    return { resp };
  }

  async handleRevokeWalletAddressKeyRequest(
    call: ServerUnaryCall<PbRevokeWalletAddressKeyRequest, Empty>
  ): Promise<UnaryResponse<Empty>> {
    await this._walletAddressAggregate.revokeWalletAddressKey(
      call.request.getWalletAddressId(),
      call.request.getKeyId()
    );

    return { resp: new Empty() };
  }
}
