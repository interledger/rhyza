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
import { Empty } from 'google-protobuf/google/protobuf/empty_pb';

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
      request.setLiquiditylowthreshold(Number(liquidityLowThreshold));
    }
    if (liquidityHighThreshold !== undefined) {
      request.setLiquidityhighthreshold(Number(liquidityHighThreshold));
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
            liquidityLowThreshold: respAsset.hasLiquiditylowthreshold()
              ? BigInt(respAsset.getLiquiditylowthreshold()!)
              : null,
            liquidityHighThreshold: respAsset.hasLiquidityhighthreshold()
              ? BigInt(respAsset.getLiquidityhighthreshold()!)
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
    address: string,
    publicName: string,
    assetCode: string,
    isActive?: boolean
  ): Promise<IPalClientWalletAddress> {
    const request = new CreateWalletAddressRequest();
    request.setAddress(address);
    request.setPublicname(publicName);
    request.setAssetcode(assetCode);
    if (isActive !== undefined) {
      request.setIsactive(isActive);
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
            address: response.getAddress(),
            publicName: response.getPublicname(),
            assetCode: response.getAssetcode(),
            assetScale: response.getAssetscale(),
            isActive: response.getIsactive()
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

          const respWallets = response.getWalletaddressesList();
          if (!respWallets || respWallets.length == 0) {
            return resolve([]);
          }

          const respObj = respWallets.map((item) => {
            return {
              id: item.getId(),
              publicName: item.getPublicname(),
              assetCode: item.getAssetcode(),
              assetScale: item.getAssetscale(),
              isActive: item.getIsactive()
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
    prefix: string | null,
    suffix: string,
    walletAddressId: string
  ): Promise<void> {
    const request = new CreateWalletAddressAliasRequest();
    if (prefix) request.setPrefix(prefix);
    request.setSuffix(suffix);
    request.setWalletaddressid(walletAddressId);

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
    prefix: string | null,
    suffix: string
  ): Promise<{
    prefix: string | null;
    suffix: string;
    walletAddressId: string;
  } | null> {
    const request = new ResolveWalletAddressAliasRequest();
    if (prefix) request.setPrefix(prefix);
    request.setSuffix(suffix);

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
            prefix: alias.hasPrefix() ? alias.getPrefix() || null : null,
            suffix: alias.getSuffix(),
            walletAddressId: alias.getWalletaddressid()
          });
        }
      );
    });
  }
}
