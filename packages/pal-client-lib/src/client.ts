import * as grpc from '@grpc/grpc-js';
import { ServiceError } from '@grpc/grpc-js';
import {
  IGetWalletAddressResponse,
  IPalClientWalletAddress,
  PalClientPeerAlreadyExistsError,
  PalClientPeerNotFoundError,
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
  PbGetLedgerAccountsRequest,
  ILedgerAccountDto,
  PbGetLedgerAccountsResponse,
  IPalAssetDto,
  PbCreatePeerRequest,
  PbPeerCommsMethodDefinition,
  IPalPeerDto,
  PbGetPeerRequest,
  PbGetPeerResponse,
  PbGetPeerByIlpAddressRequest,
  PbSetPeerCommunicationMethodRequest,
  PbActivatePeerRequest,
  PbPeer,
  PbDeactivatePeerRequest
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

// fixed until we have more comms types, then we need an enum on public-types-lib
const ILP_COMMS_TYPE = 'ILP';

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

  async createAsset(code: string, scale: number): Promise<void> {
    const request = new PbCreateAssetRequest();
    request.setCode(code);
    request.setScale(scale);

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
              creditedAmount: item.getCreditedAmount(),
              externalId: item.getExternalId()
            };
          });
          return resolve(respAccounts);
        }
      );
    });
  }

  /*
   * Peer related functions
   * */

  createPeer(
    peerId: string,
    name: string,
    assetCode: string,
    assetScale: number,
    ilpStaticAddress: string // for now the only comms type, no need to complicate
  ): Promise<void> {
    const request = new PbCreatePeerRequest();
    request.setId(peerId);
    request.setName(name);
    request.setAssetCode(assetCode);
    request.setAssetScale(assetScale);

    const commsMethod = new PbPeerCommsMethodDefinition();
    commsMethod.setCommsType(ILP_COMMS_TYPE);
    commsMethod.setStaticAddress(ilpStaticAddress);
    request.setCommsMethodDefinition(commsMethod);

    return new Promise((resolve, reject) => {
      this._grpcClient.createPeer(request, (error: ServiceError | null) => {
        if (error) {
          if (error.code == grpc.status.ALREADY_EXISTS) {
            return reject(new PalClientPeerAlreadyExistsError(error.message));
          }
          return reject(new PalClientUnknownError(error.message));
        }
        return resolve();
      });
    });
  }

  private _peerDtoFromPbPeer(pbPeer: PbPeer): IPalPeerDto {
    const retPeerDto: IPalPeerDto = {
      id: pbPeer.getId(),
      name: pbPeer.getName(),
      assetCode: pbPeer.getAssetCode(),
      assetScale: pbPeer.getAssetScale(),
      active: pbPeer.getActive(),
      ledgerAccounts: null,
      communicationMethodDefinition: null
    };

    const pbAccounts = pbPeer.getLedgerAccounts();
    if (pbAccounts) {
      retPeerDto.ledgerAccounts = {
        peerLiquidityAccId: pbAccounts.getPeerLiquidityAccountId(),
        peerClearingAccId: pbAccounts.getPeerClearingAccountId(),
        aseLiquidityAccId: pbAccounts.getAseLiquidityAccountId(),
        aseClearingAccId: pbAccounts.getAseClearingAccountId(),
        suspenseAccId: pbAccounts.getSuspenseAccountId()
      };
    }

    const commsMethod = pbPeer.getCommsMethodDefinition();
    if (commsMethod) {
      retPeerDto.communicationMethodDefinition = {
        type: ILP_COMMS_TYPE, // only type for now
        staticAddress: commsMethod.getStaticAddress()
      };
    }
    return retPeerDto;
  }

  getPeer(peerId: string): Promise<IPalPeerDto | null> {
    const request = new PbGetPeerRequest();
    request.setId(peerId);

    return new Promise((resolve, reject) => {
      this._grpcClient.getPeer(
        request,
        (error: ServiceError | null, response: PbGetPeerResponse) => {
          if (error) {
            if (error.code == grpc.status.NOT_FOUND) {
              return resolve(null);
            }
            return reject(new PalClientUnknownError(error.message));
          }
          const pbPeer = response.getPeer();
          if (!response.hasPeer() || !pbPeer) {
            // this shouldn't happen, should return NOT_FOUND, but better to handle it
            return resolve(null);
          }

          return resolve(this._peerDtoFromPbPeer(pbPeer));
        }
      );
    });
  }

  getPeerByIlpAddress(ilpAddress: string): Promise<IPalPeerDto | null> {
    const request = new PbGetPeerByIlpAddressRequest();
    request.setAddress(ilpAddress);

    return new Promise((resolve, reject) => {
      this._grpcClient.getPeerByIlpAddress(
        request,
        (error: ServiceError | null, response: PbGetPeerResponse) => {
          if (error) {
            if (error.code == grpc.status.NOT_FOUND) {
              return resolve(null);
            }
            return reject(new PalClientUnknownError(error.message));
          }
          const pbPeer = response.getPeer();
          if (!response.hasPeer() || !pbPeer) {
            // this shouldn't happen, should return NOT_FOUND, but better to handle it
            return resolve(null);
          }

          return resolve(this._peerDtoFromPbPeer(pbPeer));
        }
      );
    });
  }

  setPeerCommunicationMethod(
    peerId: string,
    ilpStaticAddress: string
  ): Promise<void> {
    const request = new PbSetPeerCommunicationMethodRequest();
    request.setPeerId(peerId);
    const pbCommsMethod = new PbPeerCommsMethodDefinition();
    pbCommsMethod.setCommsType(ILP_COMMS_TYPE);
    pbCommsMethod.setStaticAddress(ilpStaticAddress);
    request.setCommsMethod(pbCommsMethod);

    return new Promise((resolve, reject) => {
      this._grpcClient.setPeerCommunicationMethod(
        request,
        (error: ServiceError | null) => {
          if (error) {
            if (error.code == grpc.status.NOT_FOUND) {
              return reject(new PalClientPeerNotFoundError(error.message));
            }
            return reject(new PalClientUnknownError(error.message));
          }

          return resolve();
        }
      );
    });
  }

  activatePeer(peerId: string): Promise<void> {
    const request = new PbActivatePeerRequest();
    request.setPeerId(peerId);

    return new Promise((resolve, reject) => {
      this._grpcClient.activatePeer(request, (error: ServiceError | null) => {
        if (error) {
          if (error.code == grpc.status.NOT_FOUND) {
            return reject(new PalClientPeerNotFoundError(error.message));
          }
          return reject(new PalClientUnknownError(error.message));
        }

        return resolve();
      });
    });
  }

  deactivatePeer(peerId: string): Promise<void> {
    const request = new PbDeactivatePeerRequest();
    request.setPeerId(peerId);

    return new Promise((resolve, reject) => {
      this._grpcClient.deactivatePeer(request, (error: ServiceError | null) => {
        if (error) {
          if (error.code == grpc.status.NOT_FOUND) {
            return reject(new PalClientPeerNotFoundError(error.message));
          }
          return reject(new PalClientUnknownError(error.message));
        }

        return resolve();
      });
    });
  }
}
