/*****
 Copyright © 2026 & Interledger Foundation
 ----------------------------------------------
 Contributors

 * Cyberbones Digital Solutions
 - Pedro Sousa Barreto <pedrosousabarreto@gmail.com>
 ******/

'use strict';

import * as path from 'path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join } from 'path';
import { ReflectionService } from '@grpc/reflection';
import {
  sendUnaryData,
  ServerDuplexStream,
  ServerUnaryCall
} from '@grpc/grpc-js';

import { IAssetAggregate, IPalWalletAddressAliasAggregate, IWalletAddressAggregate } from 'pal-domain-lib';
import {
  CreateAssetRequest,
  CreateAssetResponse,
  CreateWalletAddressRequest,
  CreateWalletAddressResponse,
  GetAssetRequest,
  GetAssetResponse,
  GetNonEmptyAssetResponse,
  GetWalletAddressesRequest,
  GetWalletAddressesResponse,
  HealthCheckRequest,
  HealthCheckResponse,
  HealthService,
  PalGrpcService, ResolveWalletAddressIdResponse,
  ResolveWalletAddressNonEmptyResponse,
  SingleWalletAddressResponse
} from 'pal-public-types-lib';
import { ResolveWalletAddressIdRequest } from 'pal-public-types-lib';
import { CreateWalletAddressAliasRequest } from 'pal-public-types-lib';
import { Empty } from 'google-protobuf/google/protobuf/empty_pb';


const PUBLIC_TYPES_LIB_PATH = require.resolve('pal-public-types-lib');

export class PalServiceServer {
  private readonly _instanceId: string;
  private readonly _serverUrl: string;
  private readonly _server: grpc.Server;
  private readonly _assetAggregate: IAssetAggregate;
  private readonly _walletAggregate: IWalletAddressAggregate;
  private readonly _walletAliasAggregate: IPalWalletAddressAliasAggregate;
  private _startedAt: number = 0;
  private _terminating: boolean = false;

  constructor(
    instanceId: string,
    serverUrl: string,
    assetAggregate: IAssetAggregate,
    walletAggregate: IWalletAddressAggregate,
    walletAliasAggregate: IPalWalletAddressAliasAggregate
  ) {
    this._serverUrl = serverUrl;
    this._instanceId = instanceId;
    this._assetAggregate = assetAggregate;
    this._walletAggregate = walletAggregate;
    this._walletAliasAggregate = walletAliasAggregate;

    this._server = new grpc.Server({
      'grpc.max_concurrent_streams': 100,
      // Allow 60 seconds for pending RPCs to complete before forcibly closing connections
      'grpc.max_connection_age_grace_ms': 60_000,
      // Ping the client every 10 seconds to ensure the connection is still active
      'grpc.keepalive_time_ms': 10_000,
      // Wait 5 second for the ping ack before assuming the connection is dead
      'grpc.keepalive_timeout_ms': 5_000,
      // send pings even without active streams
      'grpc.keepalive_permit_without_calls': 1
    });

    // reflection implementation
    const protoDirPath = join(
      path.dirname(PUBLIC_TYPES_LIB_PATH),
      '/proto_files/'
    );
    const protoFilePath = join(protoDirPath, 'pal-svc.proto');
    const packageDefinition = protoLoader.loadSync(protoFilePath, {
      includeDirs: [protoDirPath]
    });
    const reflection = new ReflectionService(packageDefinition);
    reflection.addToServer(this._server);

    // add the health check service
    this._server.addService(HealthService, {
      check: this._handleUnaryHealthCheck.bind(this),
      watch: this._handleHealthWatchStream.bind(this)
    });

    // all unary calls are handled by the same handler, which distributes requests
    this._server.addService(PalGrpcService, {
      createAsset: this._handleUnary.bind(this),
      getAsset: this._handleUnary.bind(this),
      createWalletAddress: this._handleUnary.bind(this),
      getWalletAddresses: this._handleUnary.bind(this),
      resolveWalletAddressId: this._handleUnary.bind(this),
      createWalletAddressAlias: this._handleUnary.bind(this)
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const credentials = grpc.ServerCredentials.createInsecure();
      console.info(`Starting GRPC service in url: ${this._serverUrl}...`);

      // start the gRPC server
      this._server.bindAsync(this._serverUrl, credentials, (error) => {
        if (error !== null) {
          console.error(error);
          reject(error);
          return;
        }

        this._startedAt = Date.now();
        return resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this._terminating = true;
    console.info('Stopping the server...');

    return new Promise((resolve, reject) => {
      this._server.tryShutdown((error) => {
        if (error !== undefined) {
          console.info(`Shutdown completed with error: ${error}`);
          reject(error);
          return;
        }

        console.info('Shutdown completed successfully');
        resolve();
      });
    });
  }

  // region health check handlers
  private async _handleUnaryHealthCheck(
    call: ServerUnaryCall<HealthCheckRequest, HealthCheckResponse>,
    callback: sendUnaryData<HealthCheckResponse>
  ): Promise<void> {
    // TODO must check other services' availability
    callback(
      null,
      new HealthCheckResponse().setStatus(
        HealthCheckResponse.ServingStatus.SERVING
      )
    );
  }

  private async _handleHealthWatchStream(
    call: ServerDuplexStream<HealthCheckRequest, HealthCheckResponse>
  ): Promise<void> {
    call.emit('error', {
      code: grpc.status.UNIMPLEMENTED,
      message: 'Not yet implemented'
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _handleUnary(call: ServerUnaryCall<any, any>,callback: sendUnaryData<any>): Promise<void> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let specificRequestHandler: (call: ServerUnaryCall<any, any>) => Promise<any>;

    if (call.request instanceof CreateAssetRequest) {
      specificRequestHandler = this._handleAssetCreateRequest.bind(this);
    } else if (call.request instanceof GetAssetRequest) {
      specificRequestHandler = this._handleGetAssetRequest.bind(this);
    } else if (call.request instanceof CreateWalletAddressRequest) {
      specificRequestHandler = this._handleCreateWalletAddressRequest.bind(this);
    } else if (call.request instanceof GetWalletAddressesRequest) {
      specificRequestHandler = this._handleGetWalletAddressesRequest.bind(this);
    } else if (call.request instanceof ResolveWalletAddressIdRequest) {
      specificRequestHandler = this._handleResolveWalletAddressIdRequest.bind(this);
    } else if (call.request instanceof CreateWalletAddressAliasRequest) {
      specificRequestHandler = this._handleCreateWalletAddressAliasRequest.bind(this);
    } else {
      callback(
        new Error(`Invalid request type: ${call.request.constructor.name}`)
      );
      return;
    }

    try {
      const resp = await specificRequestHandler(call);
      callback(null, resp);
    } catch (err) {
      let returnError: Error;
      if (err instanceof Error) {
        returnError = new Error(err.message);
      } else {
        returnError = new Error('unknown error');
      }

      callback(returnError);
    }
  }

  /*
   * Asset related functions
   * */

  private async _handleAssetCreateRequest(
    call: ServerUnaryCall<CreateAssetRequest, CreateAssetResponse>
  ): Promise<CreateAssetResponse> {
    const lowThreshold = call.request.getLiquiditylowthreshold();
    const highThreshold = call.request.getLiquidityhighthreshold();

    await this._assetAggregate.createAsset(
      call.request.getCode(),
      call.request.getScale(),
      lowThreshold ? BigInt(lowThreshold) : undefined,
      highThreshold ? BigInt(highThreshold) : undefined
    );

    const resp = new CreateAssetResponse();
    resp.setCode(call.request.getCode());
    resp.setScale(call.request.getScale());

    if (lowThreshold !== null)
      resp.setLiquiditylowthreshold(Number(lowThreshold));
    if (highThreshold !== null)
      resp.setLiquidityhighthreshold(Number(highThreshold));
    return resp;
  }

  private async _handleGetAssetRequest(
    call: ServerUnaryCall<GetAssetRequest, GetAssetResponse>
  ): Promise<GetAssetResponse> {
    const asset = await this._assetAggregate.getAsset(call.request.getCode());
    const resp = new GetAssetResponse();

    if (asset) {
      const assetResp = new GetNonEmptyAssetResponse();
      assetResp.setCode(asset.code);
      assetResp.setScale(asset.scale);
      if (asset.liquidityLowThreshold !== null) {
        assetResp.setLiquiditylowthreshold(Number(asset.liquidityLowThreshold));
      }
      if (asset.liquidityHighThreshold !== null) {
        assetResp.setLiquidityhighthreshold(
          Number(asset.liquidityHighThreshold)
        );
      }
      resp.setAsset(assetResp);
    }

    return resp;
  }

  /*
   * Wallet Address related functions
   * */

  private async _handleCreateWalletAddressRequest(
    call: ServerUnaryCall<
      CreateWalletAddressRequest,
      CreateWalletAddressResponse
    >
  ): Promise<CreateWalletAddressResponse> {
    const asset = await this._assetAggregate.getAsset(
      call.request.getAssetcode()
    );

    if (!asset) {
      throw new Error(`Asset ${call.request.getAssetcode()} does not exist`);
    }

    const isActive =
      !call.request.hasIsactive() || call.request.getIsactive() == true;

    const addressId = await this._walletAggregate.createWalletAddress(
      call.request.getId(),
      call.request.getPublicname(),
      asset.code,
      asset.scale,
      isActive
    );

    return new CreateWalletAddressResponse()
      .setId(addressId)
      .setPublicname(call.request.getPublicname())
      .setAssetcode(asset.code)
      .setAssetscale(asset.scale)
      .setIsactive(isActive);
  }

  private async _handleGetWalletAddressesRequest(
    call: ServerUnaryCall<GetWalletAddressesRequest, GetWalletAddressesResponse>
  ): Promise<GetWalletAddressesResponse> {
    const wallets = await this._walletAggregate.getWalletAddresses(
      call.request.getIdsList()
    );
    const resp = new GetWalletAddressesResponse();

    const walletList = wallets.map((item) => {
      const wallet = new SingleWalletAddressResponse();
      wallet.setId(item.id);
      wallet.setPublicname(item.publicName);
      wallet.setAssetcode(item.assetCode);
      wallet.setAssetscale(item.assetScale);
      wallet.setIsactive(item.isActive);
      return wallet;
    });

    resp.setWalletaddressesList(walletList);

    return resp;
  }

  /*
   * Wallet Address Aliases related functions
   * */

  private async _handleResolveWalletAddressIdRequest(
    call: ServerUnaryCall<ResolveWalletAddressIdRequest, ResolveWalletAddressIdResponse>
  ): Promise<ResolveWalletAddressIdResponse>{

    const prefix = call.request.hasPrefix() ? call.request.getPrefix() || null : null;
    const suffix = call.request.getSuffix();

    const walletAddressId = await this._walletAliasAggregate.resolveWalletAddressId(prefix, suffix);

    const resp = new ResolveWalletAddressIdResponse();

    if(walletAddressId == null){
      return resp;
    }

    const aliasResp = new ResolveWalletAddressNonEmptyResponse();
    if(prefix) aliasResp.setPrefix(prefix);
    aliasResp.setSuffix(suffix);
    aliasResp.setWalletaddressid(walletAddressId);

    resp.setAlias(aliasResp);
    return resp;
  }

  private async _handleCreateWalletAddressAliasRequest(
    call: ServerUnaryCall<CreateWalletAddressAliasRequest, Empty>
  ): Promise<Empty>{
    const [walletAddress] = await this._walletAggregate.getWalletAddresses([call.request.getWalletaddressid()]);

    if(!walletAddress){
      throw new Error(`Wallet Address with id ${call.request.getWalletaddressid()} does not exist`);
    }

    const prefix = call.request.hasPrefix() ? call.request.getPrefix() || null : null;

    const res = await this._walletAliasAggregate.createWalletAddressAlias(prefix, call.request.getSuffix(), call.request.getWalletaddressid());
    return new Empty();
  }
}
