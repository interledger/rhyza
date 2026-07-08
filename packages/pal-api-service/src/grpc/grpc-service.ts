import * as path from 'path';
import { join } from 'path';
import * as grpc from '@grpc/grpc-js';
import {
  sendUnaryData,
  ServerDuplexStream,
  ServerUnaryCall
} from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { ReflectionService } from '@grpc/reflection';

import {
  AssetAggregate,
  AssetNotFoundError,
  FxAggregate,
  ILedgerReadSideRepository,
  PeerAggregate,
  PeerNotFoundError,
  WalletAddressAggregate,
  WalletAddressAliasNotFoundError
} from 'pal-domain-lib';
import {
  AssetActivatedEvent,
  HealthCheckRequest,
  HealthCheckResponse,
  HealthService,
  PalGrpcService,
  PeerCreationCompletedEvent
} from 'pal-public-types-lib';
import {
  DomainEvent,
  DomainEventTopics,
  ILogger,
  IMessage,
  IMessageConsumer,
  IMessageProducer,
  MessageTypes
} from 'common-types-lib';

import process from 'process';
import { LedgerNotFoundEvent } from 'pal-public-types-lib';
import { PendingResponseRegistry } from './registries/pending-response-registry';
import { AssetGrpcHandler } from './handlers/asset-handler';
import { PeerGrpcHandler } from './handlers/peer-handler';
import { WalletAddressGrpcHandler } from './handlers/wallet-address-handler';
import { LedgerGrpcHandler } from './handlers/ledger-handler';
import { EventHandlerRegistry } from './registries/event-handler-registry';
import { RequestHandlerRegistry } from './registries/request-handler-registry';
import { UnaryResponse } from './types';
import { FxGrpcHandler } from './handlers/fx-handler';

const PUBLIC_TYPES_LIB_PATH = require.resolve('pal-public-types-lib');

const DEFAULT_RESPONSE_TIMEOUT_MS = 120_000; // 2 minutes;
const DEFAULT_GRPC_KEEPALIVE_TIME_MS =
  (process.env['DEFAULT_GRPC_KEEPALIVE_TIME_MS'] &&
    parseInt(process.env['DEFAULT_GRPC_KEEPALIVE_TIME_MS'])) ||
  10_000;
const DEFAULT_GRPC_KEEPALIVE_TIMEOUT_MS =
  (process.env['DEFAULT_GRPC_KEEPALIVE_TIMEOUT_MS'] &&
    parseInt(process.env['DEFAULT_GRPC_KEEPALIVE_TIMEOUT_MS'])) ||
  5_000;

export class PalGrpcServer {
  private readonly _instanceId: string;
  private readonly _logger: ILogger;
  private readonly _serverUrl: string;
  private readonly _server: grpc.Server;
  private readonly _assetAggregate: AssetAggregate;
  private readonly _walletAddressAggregate: WalletAddressAggregate;
  private readonly _peerAggregate: PeerAggregate;
  private readonly _fxAggregate: FxAggregate;

  private readonly _msgProducer: IMessageProducer;
  private readonly _msgConsumer: IMessageConsumer;
  private readonly _ledgerReadSideRepo: ILedgerReadSideRepository;
  private readonly _responseTimeoutMs: number;

  private readonly _assetGrpcHandler: AssetGrpcHandler;
  private readonly _peerGrpcHandler: PeerGrpcHandler;
  private readonly _fxGrpcHandler: FxGrpcHandler;
  private readonly _walletAddressGrpcHandler: WalletAddressGrpcHandler;
  private readonly _ledgerGrpcHandler: LedgerGrpcHandler;

  // Holds pending gRPC callbacks keyed by command ID (UUID).
  // Kafka consumer resolves/rejects these when response events arrive.
  // Entries are cleaned up on response or when the deadline expires.
  private readonly _responseRegistry: PendingResponseRegistry;
  private readonly _eventHandlerRegistry: EventHandlerRegistry;
  private readonly _requestHandlerRegistry: RequestHandlerRegistry;

  private _startedAt: number;
  private _terminating: boolean;

  constructor(
    instanceId: string,
    serverUrl: string,
    assetAggregate: AssetAggregate,
    walletAggregate: WalletAddressAggregate,
    peerAggregate: PeerAggregate,
    fxAggregate: FxAggregate,
    producer: IMessageProducer,
    consumer: IMessageConsumer,
    ledgerReadSideRepo: ILedgerReadSideRepository,
    logger: ILogger
  ) {
    this._serverUrl = serverUrl;
    this._instanceId = instanceId;
    this._assetAggregate = assetAggregate;
    this._walletAddressAggregate = walletAggregate;
    this._peerAggregate = peerAggregate;
    this._fxAggregate = fxAggregate;
    this._msgProducer = producer;
    this._msgConsumer = consumer;
    this._ledgerReadSideRepo = ledgerReadSideRepo;
    this._logger = logger;
    this._responseTimeoutMs = DEFAULT_RESPONSE_TIMEOUT_MS;

    this._responseRegistry = new PendingResponseRegistry(
      this._responseTimeoutMs,
      logger
    );
    this._eventHandlerRegistry = new EventHandlerRegistry(logger);
    this._requestHandlerRegistry = new RequestHandlerRegistry(logger);

    this._startedAt = 0;
    this._terminating = false;

    this._assetGrpcHandler = new AssetGrpcHandler(
      this._assetAggregate,
      this._responseRegistry,
      this._msgProducer,
      this._logger
    );

    this._peerGrpcHandler = new PeerGrpcHandler(
      this._peerAggregate,
      this._responseRegistry,
      this._msgProducer,
      this._logger
    );

    this._fxGrpcHandler = new FxGrpcHandler(
      this._fxAggregate,
      this._peerAggregate,
      this._assetAggregate,
      this._responseRegistry,
      this._logger
    );

    this._walletAddressGrpcHandler = new WalletAddressGrpcHandler(
      this._walletAddressAggregate,
      this._assetAggregate,
      this._logger
    );

    this._ledgerGrpcHandler = new LedgerGrpcHandler(
      this._ledgerReadSideRepo,
      this._logger
    );

    this._registerRequestHandlers();
    this._registerEventHandlers();

    this._msgConsumer.setTopics([
      DomainEventTopics.LedgerEvents,
      DomainEventTopics.AssetEvents,
      DomainEventTopics.PeerEvents
    ]);
    this._msgConsumer.setBatchCallbackFn(
      this._handleResponseEventBatch.bind(this)
    );

    this._server = new grpc.Server({
      'grpc.max_concurrent_streams': 100,
      // Allow 60 seconds for pending RPCs to complete before forcibly closing connections
      'grpc.max_connection_age_grace_ms': 60_000,
      // Ping the client every 10 seconds to ensure the connection is still active
      'grpc.keepalive_time_ms': DEFAULT_GRPC_KEEPALIVE_TIME_MS,
      // Wait 5 seconds for the ping ack before assuming the connection is dead
      'grpc.keepalive_timeout_ms': DEFAULT_GRPC_KEEPALIVE_TIMEOUT_MS,
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
      resolveWalletAddressAlias: this._handleUnary.bind(this),
      createWalletAddressAlias: this._handleUnary.bind(this),
      createLedger: this._handleUnary.bind(this),
      createLedgerAccount: this._handleUnary.bind(this),
      getLedgerAccounts: this._handleUnary.bind(this),
      createPeer: this._handleUnary.bind(this),
      getPeer: this._handleUnary.bind(this),
      getPeerByIlpAddress: this._handleUnary.bind(this),
      setPeerCommunicationMethod: this._handleUnary.bind(this),
      activatePeer: this._handleUnary.bind(this),
      deactivatePeer: this._handleUnary.bind(this),
      getFxRate: this._handleUnary.bind(this),
      setFxRate: this._handleUnary.bind(this)
    });
  }

  async start(): Promise<void> {
    await this._msgProducer.connect();

    await this._msgConsumer.connect();
    await this._msgConsumer.startAndWaitForRebalance();

    return new Promise((resolve, reject) => {
      const credentials = grpc.ServerCredentials.createInsecure();
      this._logger.info(`Starting GRPC service in url: ${this._serverUrl}...`);

      // start the gRPC server
      this._server.bindAsync(this._serverUrl, credentials, (error) => {
        if (error !== null) {
          this._logger.error(error);
          reject(error);
          return;
        }

        this._startedAt = Date.now();
        this._logger.info('GRPC server started successfully');
        return resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this._terminating = true;
    this._logger.info('Stopping the server...');

    await this._msgConsumer.stop();
    await this._msgConsumer.disconnect(false);

    return new Promise((resolve, reject) => {
      this._server.tryShutdown((error) => {
        if (error !== undefined) {
          this._logger.info(`Shutdown completed with error: ${error}`);
          reject(error);
          return;
        }

        this._msgProducer.disconnect().then(() => {
          this._logger.info('Shutdown completed successfully');
          resolve();
        });
      });
    });
  }

  private _registerRequestHandlers() {
    // asset requests
    this._requestHandlerRegistry.register(
      PalGrpcService.createAsset,
      this._assetGrpcHandler.handleCreateAssetRequest.bind(
        this._assetGrpcHandler
      ),
      true
    );
    this._requestHandlerRegistry.register(
      PalGrpcService.getAsset,
      this._assetGrpcHandler.handleGetAssetRequest.bind(this._assetGrpcHandler)
    );

    // wallet address requests
    this._requestHandlerRegistry.register(
      PalGrpcService.createWalletAddress,
      this._walletAddressGrpcHandler.handleCreateWalletAddressRequest.bind(
        this._walletAddressGrpcHandler
      )
    );
    this._requestHandlerRegistry.register(
      PalGrpcService.getWalletAddresses,
      this._walletAddressGrpcHandler.handleGetWalletAddressesRequest.bind(
        this._walletAddressGrpcHandler
      )
    );
    this._requestHandlerRegistry.register(
      PalGrpcService.resolveWalletAddressAlias,
      this._walletAddressGrpcHandler.handleResolveWalletAddressAliasRequest.bind(
        this._walletAddressGrpcHandler
      )
    );
    this._requestHandlerRegistry.register(
      PalGrpcService.createWalletAddressAlias,
      this._walletAddressGrpcHandler.handleCreateWalletAddressAliasRequest.bind(
        this._walletAddressGrpcHandler
      )
    );

    // peer requests
    this._requestHandlerRegistry.register(
      PalGrpcService.createPeer,
      this._peerGrpcHandler.handleCreatePeerRequest.bind(this._peerGrpcHandler),
      true
    );
    this._requestHandlerRegistry.register(
      PalGrpcService.getPeer,
      this._peerGrpcHandler.handleGetPeerRequest.bind(this._peerGrpcHandler)
    );
    this._requestHandlerRegistry.register(
      PalGrpcService.getPeerByIlpAddress,
      this._peerGrpcHandler.handleGetPeerByIlpAddressRequest.bind(
        this._peerGrpcHandler
      )
    );
    this._requestHandlerRegistry.register(
      PalGrpcService.setPeerCommunicationMethod,
      this._peerGrpcHandler.handleSetPeerCommunicationMethodRequest.bind(
        this._peerGrpcHandler
      )
    );
    this._requestHandlerRegistry.register(
      PalGrpcService.activatePeer,
      this._peerGrpcHandler.handleActivatePeerRequest.bind(
        this._peerGrpcHandler
      )
    );
    this._requestHandlerRegistry.register(
      PalGrpcService.deactivatePeer,
      this._peerGrpcHandler.handleDeactivatePeerRequest.bind(
        this._peerGrpcHandler
      )
    );

    // fx requests
    this._requestHandlerRegistry.register(
      PalGrpcService.getFxRate,
      this._fxGrpcHandler.handleGetFxRateRequest.bind(this._fxGrpcHandler)
    );

    this._requestHandlerRegistry.register(
      PalGrpcService.setFxRate,
      this._fxGrpcHandler.handleSetFxRateRequest.bind(this._fxGrpcHandler)
    );

    // ledger requests
    this._requestHandlerRegistry.register(
      PalGrpcService.getLedgerAccounts,
      this._ledgerGrpcHandler.handleGetLedgerAccountsRequest.bind(
        this._ledgerGrpcHandler
      )
    );
  }

  private _registerEventHandlers() {
    this._eventHandlerRegistry.register(
      [AssetActivatedEvent.name],
      this._assetGrpcHandler.handleAssetActivatedEvent.bind(
        this._assetGrpcHandler
      )
    );

    this._eventHandlerRegistry.register(
      [PeerCreationCompletedEvent.name],
      this._peerGrpcHandler.handlePeerCreationCompletedEvent.bind(
        this._peerGrpcHandler
      )
    );

    // register a lambda handler for ledger not found event
    this._eventHandlerRegistry.register(
      [LedgerNotFoundEvent.name],
      (pendingResp) => {
        this._responseRegistry.resolve(pendingResp, {
          code: grpc.status.NOT_FOUND,
          message: `Ledger not found`
        });
        return Promise.resolve();
      }
    );
  }

  private async _handleResponseEventBatch(messages: IMessage[]): Promise<void> {
    for (const msg of messages) {
      await this._handleResponseEvent(msg);
    }
  }

  private async _handleResponseEvent(message: IMessage): Promise<void> {
    if (message.msgType !== MessageTypes.DOMAIN_EVENT) {
      return;
    }
    const domainEvent = message as DomainEvent;
    if (!domainEvent.requestId) {
      return;
    }

    // Not ours — a different API instance holds the pending callback
    const pending = this._responseRegistry.get(domainEvent.requestId);
    if (!pending) {
      return;
    }

    const handlerFunc = this._eventHandlerRegistry.getHandler(
      domainEvent.msgName
    );

    if (!handlerFunc) {
      // we ignore events unhandled event
      return;
    }

    await handlerFunc(pending, domainEvent);
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
  // endregion health check handlers

  private async _handleUnary(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call: ServerUnaryCall<any, any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: sendUnaryData<any>
  ): Promise<void> {
    const handlerObject = this._requestHandlerRegistry.get(call.getPath());

    if (!handlerObject) {
      callback(
        new Error(`Invalid request type: ${call.request.constructor.name}`)
      );
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp: UnaryResponse<any> = await handlerObject.func(call, callback);
      if (!handlerObject.async) {
        if (resp) {
          callback(resp.error || null, resp.resp || null);
        } else {
          callback({ code: grpc.status.UNKNOWN, message: 'Unknown error' });
        }
      }
    } catch (err) {
      if (
        err instanceof PeerNotFoundError ||
        err instanceof AssetNotFoundError ||
        err instanceof WalletAddressAliasNotFoundError
      ) {
        callback({
          code: grpc.status.NOT_FOUND,
          message: (err as Error).message
        });
      } else if (err instanceof Error) {
        callback({
          code: grpc.status.INTERNAL,
          message: err.message
        });
      } else {
        callback({
          code: grpc.status.UNKNOWN,
          message: 'Unknown error'
        });
      }
    }
  }
}
