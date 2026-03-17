/*****
 Copyright © 2026 & Interledger Foundation
 ----------------------------------------------
 Contributors

 * Cyberbones Digital Solutions
 - Pedro Sousa Barreto <pedrosousabarreto@gmail.com>
 ******/

'use strict';

import * as grpc from '@grpc/grpc-js';
import { ServiceError } from '@grpc/grpc-js';
import {
  IGetWalletAddressResponse,
  IPalClientAsset,
  IPalClientWalletAddress
} from './local-types';
import {
  CreateAssetRequest,
  CreateWalletAddressAliasRequest,
  CreateWalletAddressRequest,
  CreateWalletAddressResponse,
  GetAssetRequest,
  GetAssetResponse,
  GetWalletAddressesRequest,
  GetWalletAddressesResponse,
  PalGrpcClient,
  ResolveWalletAddressAliasRequest,
  ResolveWalletAddressAliasResponse
} from 'pal-public-types-lib';

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
        'grpc.keepalive_time_ms': 10000,
        'grpc.keepalive_timeout_ms': 5000,
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
    const request = new CreateAssetRequest();
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
          return reject(error);
        }

        return resolve();
      });
    });
  }

  async getAsset(code: string): Promise<IPalClientAsset | null> {
    const request = new GetAssetRequest();
    request.setCode(code);

    return new Promise((resolve, reject) => {
      this._grpcClient.getAsset(
        request,
        (error: ServiceError | null, response: GetAssetResponse) => {
          if (error) {
            console.error(error);
            return reject(error);
          }

          if (!response.hasAsset()) {
            return resolve(null);
          }
          const respAsset = response.getAsset();
          if (!respAsset) {
            return resolve(null);
          }

          const respObj: IPalClientAsset = {
            code: respAsset.getCode(),
            scale: respAsset.getScale(),
            liquidityLowThreshold: respAsset.hasLiquidityLowThreshold()
              ? BigInt(respAsset.getLiquidityLowThreshold()!)
              : null,
            liquidityHighThreshold: respAsset.hasLiquidityHighThreshold()
              ? BigInt(respAsset.getLiquidityHighThreshold()!)
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
    const request = new CreateWalletAddressRequest();
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
        (error: ServiceError | null, response: CreateWalletAddressResponse) => {
          if (error) {
            console.error(error);
            return reject(error);
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
    const request = new GetWalletAddressesRequest();
    request.setIdsList(ids);

    return new Promise((resolve, reject) => {
      this._grpcClient.getWalletAddresses(
        request,
        (error: ServiceError | null, response: GetWalletAddressesResponse) => {
          if (error) {
            console.error(error);
            return reject(error);
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
    const request = new CreateWalletAddressAliasRequest();
    if (domain) request.setDomain(domain);
    request.setPathName(pathName);
    request.setWalletAddressId(walletAddressId);

    return new Promise((resolve, reject) => {
      this._grpcClient.createWalletAddressAlias(
        request,
        (error: ServiceError | null) => {
          if (error) {
            console.error(error);
            return reject(error);
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
    const request = new ResolveWalletAddressAliasRequest();
    if (domain) request.setDomain(domain);
    request.setPathName(pathName);

    return new Promise((resolve, reject) => {
      this._grpcClient.resolveWalletAddressAlias(
        request,
        (
          error: ServiceError | null,
          response: ResolveWalletAddressAliasResponse
        ) => {
          if (error) {
            console.error(error);
            return reject(error);
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
}
