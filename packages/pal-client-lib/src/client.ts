import * as grpc from '@grpc/grpc-js';
import { ServiceError } from '@grpc/grpc-js';
import {
  IGetWalletAddressResponse,
  IPalClientWalletAddress,
  PalClientLedgerAccountAlreadyExistsError,
  PalClientLedgerAlreadyExistsError,
  PalClientLedgerNotFoundError,
  PalClientLedgerUnknownError,
  PalClientUnknownError
} from './local-types';
import {
  PbCreateAssetRequest,
  PbCreateWalletAddressAliasRequest,
  PbCreateWalletAddressRequest,
  PbCreateWalletAddressResponse,
  PbGetAssetRequest,
  PbGetAssetResponse,
  PbGetWalletAddressesRequest,
  PbGetWalletAddressesResponse,
  PalGrpcClient,
  PbResolveWalletAddressAliasRequest,
  PbResolveWalletAddressAliasResponse,
  PbCreateLedgerRequest,
  PbCreateLedgerAccountRequest,
  PbGetLedgerAccountsRequest,
  ILedgerAccountDto,
  PbGetLedgerAccountsResponse,
  IPalAssetDto
} from 'pal-public-types-lib';
import process from 'process';

const DEFAULT_GRPC_KEEPALIVE_TIME_MS =
  (process.env['DEFAULT_GRPC_KEEPALIVE_TIME_MS'] &&
    parseInt(process.env['DEFAULT_GRPC_KEEPALIVE_TIME_MS'])) ||
  10_000;
const DEFAULT_GRPC_KEEPALIVE_TIMEOUT_MS =
  (process.env['DEFAULT_GRPC_KEEPALIVE_TIMEOUT_MS'] &&
    parseInt(process.env['DEFAULT_GRPC_KEEPALIVE_TIMEOUT_MS'])) ||
  5_000;

export class PalClient {
  private readonly _serverUrl: string;
  private readonly _grpcConnectTimeOutMs: number;
  private readonly _grpcClient: PalGrpcClient;

  constructor(serverUrl: string, grpcConnectTimeOutMs: number = 5_000) {
    this._serverUrl = serverUrl;
    this._grpcConnectTimeOutMs = grpcConnectTimeOutMs;

    this._grpcClient = new PalGrpcClient(
      this._serverUrl,
      grpc.credentials.createInsecure(),
      {
        'grpc.max_receive_message_length': 100 * 1024 * 1024,
        'grpc.max_send_message_length': 100 * 1024 * 1024,
        'grpc.keepalive_time_ms': DEFAULT_GRPC_KEEPALIVE_TIME_MS,
        'grpc.keepalive_timeout_ms': DEFAULT_GRPC_KEEPALIVE_TIMEOUT_MS,
        'grpc.keepalive_permit_without_calls': 1
      }
    );
  }

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const deadline: grpc.Deadline = Date.now() + this._grpcConnectTimeOutMs;
      this._grpcClient.waitForReady(deadline, (error?: Error) => {
        if (error) return reject(error);

        return resolve();
      });
    });
  }

  async disconnect(): Promise<void> {
    this._grpcClient.close();
    return Promise.resolve();
  }

  /*
   * Asset related functions
   * */

  async createAsset(
    code: string,
    scale: number,
    liquidityLowThreshold?: bigint,
    liquidityHighThreshold?: bigint
  ): Promise<void> {
    const request = new PbCreateAssetRequest();
    request.setCode(code);
    request.setScale(scale);

    if (liquidityLowThreshold !== undefined) {
      request.setLiquidityLowThreshold(Number(liquidityLowThreshold));
    }
    if (liquidityHighThreshold !== undefined) {
      request.setLiquidityHighThreshold(Number(liquidityHighThreshold));
    }

    return new Promise((resolve, reject) => {
      this._grpcClient.createAsset(request, (error: ServiceError | null) => {
        if (error) {
          console.error(error);
          return reject(new PalClientUnknownError(error.message));
        }

        return resolve();
      });
    });
  }

  async getAsset(code: string): Promise<IPalAssetDto | null> {
    const request = new PbGetAssetRequest();
    request.setCode(code);

    return new Promise((resolve, reject) => {
      this._grpcClient.getAsset(
        request,
        (error: ServiceError | null, response: PbGetAssetResponse) => {
          if (error) {
            console.error(error);
            return reject(new PalClientUnknownError(error.message));
          }

          if (!response.hasAsset()) {
            return resolve(null);
          }
          const respAsset = response.getAsset();
          if (!respAsset) {
            return resolve(null);
          }

          const respObj: IPalAssetDto = {
            code: respAsset.getCode(),
            scale: respAsset.getScale(),
            liquidityLowThreshold: respAsset.hasLiquidityLowThreshold()
              ? BigInt(respAsset.getLiquidityLowThreshold()!)
              : null,
            liquidityHighThreshold: respAsset.hasLiquidityHighThreshold()
              ? BigInt(respAsset.getLiquidityHighThreshold()!)
              : null,
            ledgerAccountId: respAsset.hasLedgerAccountId()
              ? respAsset.getLedgerAccountId()!
              : null
          };

          return resolve(respObj);
        }
      );
    });
  }

  /*
   * Wallet Address related functions
   * */

  async createWalletAddress(
    domain: string | null,
    pathName: string,
    publicName: string,
    assetCode: string,
    isActive?: boolean
  ): Promise<IPalClientWalletAddress> {
    const request = new PbCreateWalletAddressRequest();
    if (domain) {
      request.setDomain(domain);
    }
    request.setPathName(pathName);
    request.setPublicName(publicName);
    request.setAssetCode(assetCode);
    if (isActive !== undefined) {
      request.setIsActive(isActive);
    }

    return new Promise((resolve, reject) => {
      this._grpcClient.createWalletAddress(
        request,
        (
          error: ServiceError | null,
          response: PbCreateWalletAddressResponse
        ) => {
          if (error) {
            console.error(error);
            return reject(new PalClientUnknownError(error.message));
          }

          return resolve({
            domain: response.getDomain() ?? null,
            pathName: response.getPathName(),
            publicName: response.getPublicName(),
            assetCode: response.getAssetCode(),
            assetScale: response.getAssetScale(),
            isActive: response.getIsActive()
          });
        }
      );
    });
  }

  async getWalletAddresses(
    ids: string[]
  ): Promise<IGetWalletAddressResponse[]> {
    const request = new PbGetWalletAddressesRequest();
    request.setIdsList(ids);

    return new Promise((resolve, reject) => {
      this._grpcClient.getWalletAddresses(
        request,
        (
          error: ServiceError | null,
          response: PbGetWalletAddressesResponse
        ) => {
          if (error) {
            console.error(error);
            return reject(new PalClientUnknownError(error.message));
          }

          const respWallets = response.getWalletAddressesList();
          if (!respWallets || respWallets.length == 0) {
            return resolve([]);
          }

          const respObj = respWallets.map((item) => {
            return {
              id: item.getId(),
              publicName: item.getPublicName(),
              assetCode: item.getAssetCode(),
              assetScale: item.getAssetScale(),
              isActive: item.getIsActive()
            };
          });

          return resolve(respObj);
        }
      );
    });
  }

  /*
   * Wallet Address Alias related functions
   * */

  async createWalletAddressAlias(
    domain: string | null,
    pathName: string,
    walletAddressId: string
  ): Promise<void> {
    const request = new PbCreateWalletAddressAliasRequest();
    if (domain) request.setDomain(domain);
    request.setPathName(pathName);
    request.setWalletAddressId(walletAddressId);

    return new Promise((resolve, reject) => {
      this._grpcClient.createWalletAddressAlias(
        request,
        (error: ServiceError | null) => {
          if (error) {
            console.error(error);
            return reject(new PalClientUnknownError(error.message));
          }

          return resolve();
        }
      );
    });
  }

  async ResolveWalletAddressAlias(
    domain: string | null,
    pathName: string
  ): Promise<{
    domain: string | null;
    pathName: string;
    walletAddressId: string;
  } | null> {
    const request = new PbResolveWalletAddressAliasRequest();
    if (domain) request.setDomain(domain);
    request.setPathName(pathName);

    return new Promise((resolve, reject) => {
      this._grpcClient.resolveWalletAddressAlias(
        request,
        (
          error: ServiceError | null,
          response: PbResolveWalletAddressAliasResponse
        ) => {
          if (error) {
            return reject(new PalClientUnknownError(error.message));
          }

          const alias = response.getAlias();

          if (!response.hasAlias() || !alias) {
            return resolve(null);
          }

          return resolve({
            domain: alias.hasDomain() ? alias.getDomain() || null : null,
            pathName: alias.getPathName(),
            walletAddressId: alias.getWalletAddressId()
          });
        }
      );
    });
  }

  /*
   * ledger related functions
   * */

  createLedger(assetCode: string): Promise<void> {
    const request = new PbCreateLedgerRequest();
    request.setLedgerAssetCode(assetCode);

    return new Promise((resolve, reject) => {
      this._grpcClient.createLedger(request, (error: ServiceError | null) => {
        if (error) {
          if (error.code == grpc.status.ALREADY_EXISTS) {
            return reject(new PalClientLedgerAlreadyExistsError(error.message));
          }
          return reject(new PalClientLedgerUnknownError(error.message));
        }
        return resolve();
      });
    });
  }

  createLedgerAccount(
    accId: string,
    assetCode: string,
    assetDisplayScale: number,
    name: string
  ): Promise<void> {
    const request = new PbCreateLedgerAccountRequest();
    request.setId(accId);
    request.setAssetCode(assetCode);
    request.setAssetDisplayScale(assetDisplayScale);
    request.setName(name);

    return new Promise((resolve, reject) => {
      this._grpcClient.createLedgerAccount(
        request,
        (error: ServiceError | null) => {
          if (error) {
            if (error.code == grpc.status.ALREADY_EXISTS) {
              return reject(
                new PalClientLedgerAccountAlreadyExistsError(error.message)
              );
            } else if (error.code == grpc.status.NOT_FOUND) {
              return reject(new PalClientLedgerNotFoundError(error.message));
            }
            return reject(new PalClientLedgerUnknownError(error.message));
          }
          return resolve();
        }
      );
    });
  }

  getLedgerAccounts(ids: string[]): Promise<ILedgerAccountDto[]> {
    const request = new PbGetLedgerAccountsRequest();
    request.setAccountIdsList(ids);

    return new Promise((resolve, reject) => {
      this._grpcClient.getLedgerAccounts(
        request,
        (error: ServiceError | null, response: PbGetLedgerAccountsResponse) => {
          if (error) {
            return reject(error);
          }

          const respAccounts = response.getAccountsList().map((item) => {
            return {
              id: item.getId(),
              name: item.getName(),
              assetCode: item.getAssetCode(),
              assetDisplayScale: item.getAssetDisplayScale(),
              debitedAmount: item.getDebitedAmount(),
              creditedAmount: item.getCreditedAmount()
            };
          });
          return resolve(respAccounts);
        }
      );
    });
  }
}
