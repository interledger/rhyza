import * as grpc from '@grpc/grpc-js';
import { ServiceError } from '@grpc/grpc-js';
import {
  IGetIntraAseFxRate,
  IGetPeerFxRateFromSourceAsset,
  IGetPeerFxRateToDestinationAsset,
  IGetWalletAddressResponse,
  IPalClientLiquidityRequest,
  IPalClientLiquidityResponse,
  IPalClientWalletAddress,
  PalClientLedgerInsufficientFundsForWithdrawalError,
  PalClientLedgerUnknownError,
  PalClientPeerAlreadyExistsError,
  PalClientPeerNotFoundError,
  PalClientUnknownError,
  PalClientWalletAddressAlreadyActiveError,
  PalClientWalletAddressAlreadyInactiveError,
  PalClientWalletAddressNotFoundError,
  PalClientWalletAddressKeyNotFoundError,
  PalClientWalletAddressKeyAlreadyRevokedError,
  PalClientDuplicateWalletAddressKeyError,
  PalClientInvalidWalletAddressJwkError
} from './local-types';
import {
  PbCreateAssetRequest,
  PbCreateWalletAddressAliasRequest,
  PbCreateWalletAddressRequest,
  PbActivateWalletAddressRequest,
  PbCreateWalletAddressResponse,
  PbGetAssetsRequest,
  PbGetAssetsResponse,
  PbDeactivateWalletAddressRequest,
  PbGetWalletAddressesRequest,
  PbGetWalletAddressesResponse,
  PalGrpcClient,
  PbResolveWalletAddressAliasRequest,
  PbResolveWalletAddressAliasResponse,
  PbGetLedgerAccountsRequest,
  ILedgerAccountDto,
  PbGetLedgerAccountsResponse,
  IPalAssetDto,
  IPalJsonWebKeyDto,
  IPalWalletAddressKeyDto,
  jsonWebKeyToPb,
  walletAddressKeyFromPb,
  PbAddWalletAddressKeyRequest,
  PbAddWalletAddressKeyResponse,
  PbGetWalletAddressKeysRequest,
  PbGetWalletAddressKeysResponse,
  PbRevokeWalletAddressKeyRequest,
  PbCreatePeerRequest,
  PbPeerCommsMethodDefinition,
  IPalPeerDto,
  PbGetPeerRequest,
  PbGetPeerResponse,
  PbGetPeerByIlpAddressRequest,
  PbSetPeerCommunicationMethodRequest,
  PbActivatePeerRequest,
  PbPeer,
  PbDeactivatePeerRequest,
  PbGetFxRateRequest,
  PbGetFxRateResponse,
  PbSetFxRateRequest,
  PbGetPeerFxRateFromSourceAssetRequest,
  PbGetPeerFxRateToDestinationAssetRequest,
  PbGetIntraAseFxRateRequest,
  PbLedgerLiquidityManagementRequest,
  PbLedgerLiquidityManagementResponse
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

  async getAssets(codes?: string[]): Promise<IPalAssetDto[]> {
    const request = new PbGetAssetsRequest();
    if (codes && codes.length > 0) {
      request.setCodesList(codes);
    }

    return new Promise((resolve, reject) => {
      this._grpcClient.getAssets(
        request,
        (error: ServiceError | null, response: PbGetAssetsResponse) => {
          if (error) {
            console.error(error);
            return reject(new PalClientUnknownError(error.message));
          }
          const resAssets = response.getAssetsList();

          const respAssets = resAssets.map((asset) => {
            return {
              code: asset.getCode(),
              scale: asset.getScale(),
              ledgerAccountId: asset.hasLedgerAccountId()
                ? asset.getLedgerAccountId()!
                : null
            };
          });

          return resolve(respAssets);
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
            id: response.getId(),
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

  activateWalletAddress(walletAddressId: string): Promise<void> {
    const request = new PbActivateWalletAddressRequest();
    request.setWalletAddressId(walletAddressId);

    return new Promise((resolve, reject) => {
      this._grpcClient.activateWalletAddress(
        request,
        (error: ServiceError | null) => {
          if (error) {
            if (error.code === grpc.status.NOT_FOUND) {
              return reject(
                new PalClientWalletAddressNotFoundError(error.message)
              );
            }
            if (error.code === grpc.status.FAILED_PRECONDITION) {
              return reject(
                new PalClientWalletAddressAlreadyActiveError(error.message)
              );
            }
            return reject(new PalClientUnknownError(error.message));
          }

          return resolve();
        }
      );
    });
  }

  deactivateWalletAddress(walletAddressId: string): Promise<void> {
    const request = new PbDeactivateWalletAddressRequest();
    request.setWalletAddressId(walletAddressId);

    return new Promise((resolve, reject) => {
      this._grpcClient.deactivateWalletAddress(
        request,
        (error: ServiceError | null) => {
          if (error) {
            if (error.code === grpc.status.NOT_FOUND) {
              return reject(
                new PalClientWalletAddressNotFoundError(error.message)
              );
            }
            if (error.code === grpc.status.FAILED_PRECONDITION) {
              return reject(
                new PalClientWalletAddressAlreadyInactiveError(error.message)
              );
            }
            return reject(new PalClientUnknownError(error.message));
          }

          return resolve();
        }
      );
    });
  }

  async addWalletAddressKey(
    walletAddressId: string,
    jwk: IPalJsonWebKeyDto
  ): Promise<string> {
    const request = new PbAddWalletAddressKeyRequest();
    request.setWalletAddressId(walletAddressId);
    request.setJwk(jsonWebKeyToPb(jwk));

    return new Promise((resolve, reject) => {
      this._grpcClient.addWalletAddressKey(
        request,
        (
          error: ServiceError | null,
          response: PbAddWalletAddressKeyResponse
        ) => {
          if (error) {
            return reject(mapWalletAddressKeyError(error));
          }

          return resolve(response.getId());
        }
      );
    });
  }

  async getWalletAddressKeys(
    walletAddressId: string
  ): Promise<IPalWalletAddressKeyDto[]> {
    const request = new PbGetWalletAddressKeysRequest();
    request.setWalletAddressId(walletAddressId);

    return new Promise((resolve, reject) => {
      this._grpcClient.getWalletAddressKeys(
        request,
        (
          error: ServiceError | null,
          response: PbGetWalletAddressKeysResponse
        ) => {
          if (error) {
            return reject(mapWalletAddressKeyError(error));
          }

          try {
            return resolve(response.getKeysList().map(walletAddressKeyFromPb));
          } catch (e) {
            return reject(new PalClientUnknownError((e as Error).message));
          }
        }
      );
    });
  }

  async revokeWalletAddressKey(
    walletAddressId: string,
    keyId: string
  ): Promise<void> {
    const request = new PbRevokeWalletAddressKeyRequest();
    request.setWalletAddressId(walletAddressId);
    request.setKeyId(keyId);

    return new Promise((resolve, reject) => {
      this._grpcClient.revokeWalletAddressKey(
        request,
        (error: ServiceError | null) => {
          if (error) {
            if (error.code === grpc.status.NOT_FOUND) {
              return reject(
                new PalClientWalletAddressKeyNotFoundError(error.message)
              );
            }
            if (error.code === grpc.status.FAILED_PRECONDITION) {
              return reject(
                new PalClientWalletAddressKeyAlreadyRevokedError(error.message)
              );
            }
            return reject(new PalClientUnknownError(error.message));
          }

          return resolve();
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

  async resolveWalletAddressAlias(
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
              type: item.getType() as
                | 'ASSET_LIQUIDITY_ACCOUNT'
                | 'PEER_LIQUIDITY_ACCOUNT'
                | 'PEER_CLEARING_ACCOUNT'
                | 'ASE_LIQUIDITY_ACCOUNT'
                | 'ASE_CLEARING_ACCOUNT'
                | 'SUSPENSE_ACCOUNT',
              name: item.getName(),
              assetCode: item.getAssetCode(),
              assetDisplayScale: item.getAssetDisplayScale(),
              debitedAmount: item.getDebitedAmount(),
              creditedAmount: item.getCreditedAmount(),
              peerId: item.getPeerId()
            };
          });
          return resolve(respAccounts);
        }
      );
    });
  }

  private _createPbLedgerLiquidityManagementRequest(
    request: IPalClientLiquidityRequest
  ): PbLedgerLiquidityManagementRequest {
    const pbReq = new PbLedgerLiquidityManagementRequest();
    pbReq.setRequestId(request.requestId);
    pbReq.setPeerId(request.peerId);
    pbReq.setAssetCode(request.assetCode);
    pbReq.setAmountScale(request.amountScale);
    pbReq.setAmount(request.amount);
    if (request.externalId != undefined)
      pbReq.setExternalId(request.externalId);
    return pbReq;
  }

  private async _executeLedgerLiquidityManagementResp(
    pbReq: PbLedgerLiquidityManagementRequest
  ): Promise<IPalClientLiquidityResponse> {
    return new Promise((resolve, reject) => {
      this._grpcClient.executeLedgerLiquidityManagementRequest(
        pbReq,
        (
          srvError: ServiceError | null,
          srvResponse: PbLedgerLiquidityManagementResponse
        ) => {
          if (srvError) {
            return reject(srvError.message);
          }

          const commonResp: IPalClientLiquidityResponse = {
            isError: false,
            errorMessage: undefined,
            peerId: srvResponse.getPeerId(),
            requestId: srvResponse.getRequestId(),
            externalId: undefined
          };

          if (srvResponse.hasExternalId()) {
            commonResp.externalId = srvResponse.getExternalId();
          }

          if (srvResponse.hasSuccess()) {
            return resolve(commonResp);
          } else if (srvResponse.hasInsufficientFundsFailure()) {
            const specificResp = srvResponse.getInsufficientFundsFailure();
            return reject(
              new PalClientLedgerInsufficientFundsForWithdrawalError(
                specificResp?.getErrorMessage()
              )
            );
          } else {
            const specificResp = srvResponse.getGenericFailure();
            return reject(
              new PalClientLedgerUnknownError(specificResp?.getErrorMessage())
            );
          }
        }
      );
    });
  }

  async ledgerDepositToAse(
    request: IPalClientLiquidityRequest
  ): Promise<IPalClientLiquidityResponse> {
    const pbReq = this._createPbLedgerLiquidityManagementRequest(request);
    pbReq.setType(PbLedgerLiquidityManagementRequest.Type.DEPOSIT_TO_ASE);
    return this._executeLedgerLiquidityManagementResp(pbReq);
  }

  ledgerDepositToPeer(
    request: IPalClientLiquidityRequest
  ): Promise<IPalClientLiquidityResponse> {
    const pbReq = this._createPbLedgerLiquidityManagementRequest(request);
    pbReq.setType(PbLedgerLiquidityManagementRequest.Type.DEPOSIT_TO_PEER);
    return this._executeLedgerLiquidityManagementResp(pbReq);
  }

  ledgerWithdrawFromAse(
    request: IPalClientLiquidityRequest
  ): Promise<IPalClientLiquidityResponse> {
    const pbReq = this._createPbLedgerLiquidityManagementRequest(request);
    pbReq.setType(PbLedgerLiquidityManagementRequest.Type.WITHDRAW_FROM_ASE);
    return this._executeLedgerLiquidityManagementResp(pbReq);
  }
  ledgerWithdrawFromPeer(
    request: IPalClientLiquidityRequest
  ): Promise<IPalClientLiquidityResponse> {
    const pbReq = this._createPbLedgerLiquidityManagementRequest(request);
    pbReq.setType(PbLedgerLiquidityManagementRequest.Type.WITHDRAW_FROM_PEER);
    return this._executeLedgerLiquidityManagementResp(pbReq);
  }

  /**
   * Convert an amount in integer string notation from the ledger to the
   * correct string representation with the provided amount scale.
   * @param amountStr Integer amount string
   * @param displayScale precision scale
   */
  amountStrToDisplayAmountStr(amountStr: string, displayScale: number): string {
    if (displayScale < 0) {
      throw new Error('Display scale must be greater than or equal to zero');
    }

    if (displayScale == 0) {
      return amountStr;
    } else if (amountStr.length > displayScale) {
      return (
        amountStr.slice(0, -displayScale) + '.' + amountStr.slice(-displayScale)
      );
    } else if (amountStr.length == displayScale) {
      return '0.' + amountStr;
    }

    const diff = displayScale - amountStr.length;
    return '0.' + '0'.repeat(diff) + amountStr;
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

  async getFxRate(
    request:
      | IGetPeerFxRateFromSourceAsset
      | IGetPeerFxRateToDestinationAsset
      | IGetIntraAseFxRate
  ): Promise<number | null> {
    const pbReq = new PbGetFxRateRequest();

    if (
      Object.hasOwn(request, 'sourceAssetCode') &&
      Object.hasOwn(request, 'destinationAssetCode')
    ) {
      const typedRequest = request as IGetIntraAseFxRate;
      const subReq = new PbGetIntraAseFxRateRequest();
      subReq.setSourceAssetCode(typedRequest.sourceAssetCode);
      subReq.setDestinationAssetCode(typedRequest.destinationAssetCode);
      pbReq.setIntraAseRequest(subReq);
    } else if (
      Object.hasOwn(request, 'peerId') &&
      Object.hasOwn(request, 'sourceAssetCode')
    ) {
      const typedRequest = request as IGetPeerFxRateFromSourceAsset;
      const subReq = new PbGetPeerFxRateFromSourceAssetRequest();
      subReq.setPeerId(typedRequest.peerId);
      subReq.setSourceAssetCode(typedRequest.sourceAssetCode);
      pbReq.setFromSourceRequest(subReq);
    } else if (
      Object.hasOwn(request, 'peerId') &&
      Object.hasOwn(request, 'destinationAssetCode')
    ) {
      const typedRequest = request as IGetPeerFxRateToDestinationAsset;
      const subReq = new PbGetPeerFxRateToDestinationAssetRequest();
      subReq.setPeerId(typedRequest.peerId);
      subReq.setDestinationAssetCode(typedRequest.destinationAssetCode);
      pbReq.setToDestinationRequest(subReq);
    } else {
      throw new PalClientUnknownError('Invalid request getFxRate request');
    }

    return new Promise((resolve, reject) => {
      this._grpcClient.getFxRate(
        pbReq,
        (error: ServiceError | null, response: PbGetFxRateResponse) => {
          if (error) {
            if (error.code == grpc.status.NOT_FOUND) {
              return reject(new PalClientPeerNotFoundError(error.message));
            }
            return reject(new PalClientUnknownError(error.message));
          }
          const rate = response.getRate();
          if (!response.hasRate() || rate === undefined) {
            return resolve(null);
          }

          return resolve(rate);
        }
      );
    });
  }

  async setFxRate(
    sourceAssetCode: string,
    destinationAsset: string,
    rate: number,
    peerId: string | null,
    rateTtlSecs: number | null
  ): Promise<void> {
    const pbReq = new PbSetFxRateRequest();

    pbReq.setSourceAssetCode(sourceAssetCode);
    pbReq.setDestinationAssetCode(destinationAsset);
    pbReq.setRate(rate);
    if (rateTtlSecs !== null) {
      pbReq.setRateTtlSecs(rateTtlSecs);
    }

    if (peerId !== null) {
      pbReq.setPeerId(peerId);
    }

    return new Promise((resolve, reject) => {
      this._grpcClient.setFxRate(pbReq, (error: ServiceError | null) => {
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

function mapWalletAddressKeyError(error: ServiceError): Error {
  if (error.code === grpc.status.NOT_FOUND) {
    return new PalClientWalletAddressNotFoundError(error.message);
  }
  if (error.code === grpc.status.ALREADY_EXISTS) {
    return new PalClientDuplicateWalletAddressKeyError(error.message);
  }
  if (error.code === grpc.status.INVALID_ARGUMENT) {
    return new PalClientInvalidWalletAddressJwkError(error.message);
  }
  return new PalClientUnknownError(error.message);
}
