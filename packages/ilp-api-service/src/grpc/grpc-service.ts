/* eslint-disable @typescript-eslint/no-explicit-any */
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

import {
  CreatePeerRequest,
  CreatePeerResponse,
  GetPeerRequest,
  GetPeerResponse,
  HealthCheckRequest,
  HealthCheckResponse,
  HealthService,
  IlpGrpcService,
  ListPeersRequest,
  ListPeersResponse,
  Peer as PbPeer,
  PeerHttpIncomingSettings,
  PeerHttpOutgoingSettings,
  PeerHttpSettings,
  UpdatePeerRequest,
  UpdatePeerResponse
} from 'ilp-public-types-lib';
import {
  ILPPeerCreatedEvent,
  ILPPeerCreationFailedEvent,
  ILPPeerUpdatedEvent,
  ILPPeerUpdateFailedEvent,
  IPeer,
  IPeerReader
} from 'ilp-domain-lib';
import { CreatePeerCmd, UpdatePeerCmd } from 'ilp-domain-lib';
import {
  ILogger,
  IMessage,
  IMessageConsumer,
  IMessageProducer
} from 'common-types-lib';

const PUBLIC_TYPES_LIB_PATH = require.resolve('ilp-public-types-lib');

const DEFAULT_RESPONSE_TIMEOUT_MS = 120_000; // 2 minutes;

interface PendingResponse {
  callback: sendUnaryData<any>;
  timer: ReturnType<typeof setTimeout>;
}

export class IlpServiceServer {
  private readonly _serverUrl: string;
  private readonly _server: grpc.Server;
  private readonly _msgProducer: IMessageProducer;
  private readonly _msgConsumer: IMessageConsumer;
  private readonly _peerRepo: IPeerReader;
  private readonly _responseTimeoutMs: number;
  private readonly _responseMap: Map<string, PendingResponse> = new Map();
  private readonly _logger: ILogger;
  private _startedAt: number = 0;
  private _terminating: boolean = false;

  constructor(
    serverUrl: string,
    msgProducer: IMessageProducer,
    msgConsumer: IMessageConsumer,
    peerRepo: IPeerReader,
    logger: ILogger,
    responseTimeoutMs: number = DEFAULT_RESPONSE_TIMEOUT_MS
  ) {
    this._logger = logger;
    this._responseTimeoutMs = responseTimeoutMs;
    this._serverUrl = serverUrl;
    this._msgProducer = msgProducer;
    this._msgConsumer = msgConsumer;
    this._peerRepo = peerRepo;

    this._msgConsumer.setBatchCallbackFn(this._handleBatch.bind(this));

    this._server = new grpc.Server({
      'grpc.max_concurrent_streams': 100,
      'grpc.max_connection_age_grace_ms': 60_000,
      'grpc.keepalive_time_ms': 10_000,
      'grpc.keepalive_timeout_ms': 5_000,
      'grpc.keepalive_permit_without_calls': 1
    });

    // reflection
    const protoDirPath = join(
      path.dirname(PUBLIC_TYPES_LIB_PATH),
      '/proto_files/'
    );
    const protoFilePath = join(protoDirPath, 'ilp-svc.proto');
    const packageDefinition = protoLoader.loadSync(protoFilePath, {
      includeDirs: [protoDirPath]
    });
    const reflection = new ReflectionService(packageDefinition);
    reflection.addToServer(this._server);

    // health check service
    this._server.addService(HealthService, {
      check: this._handleUnaryHealthCheck.bind(this),
      watch: this._handleHealthWatchStream.bind(this)
    });

    // ILP peer service RPCs
    this._server.addService(IlpGrpcService, {
      createPeer: this._handleCreatePeer.bind(this),
      updatePeer: this._handleUpdatePeer.bind(this),
      getPeer: this._handleGetPeer.bind(this),
      listPeers: this._handleListPeers.bind(this)
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const credentials = grpc.ServerCredentials.createInsecure();
      this._logger.info(`Starting ILP GRPC service at: ${this._serverUrl}...`);

      this._server.bindAsync(this._serverUrl, credentials, (error) => {
        if (error !== null) {
          this._logger.error(error);
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
    this._logger.info('Stopping the server...');

    return new Promise((resolve, reject) => {
      this._server.tryShutdown((error) => {
        if (error !== undefined) {
          this._logger.info(`Shutdown completed with error: ${error}`);
          reject(error);
          return;
        }

        this._logger.info('Shutdown completed successfully');
        resolve();
      });
    });
  }

  // region health check handlers
  private async _handleUnaryHealthCheck(
    call: ServerUnaryCall<HealthCheckRequest, HealthCheckResponse>,
    callback: sendUnaryData<HealthCheckResponse>
  ): Promise<void> {
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

  private async _handleCreatePeer(
    call: ServerUnaryCall<CreatePeerRequest, CreatePeerResponse>,
    callback: sendUnaryData<CreatePeerResponse>
  ): Promise<void> {
    const peer = call.request.getPeer();
    if (!peer) {
      callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: 'peer is required'
      });
      return;
    }

    let http: IPeer['http'];
    try {
      http = this._pbHttpToDomain(peer.getHttp());
    } catch (err) {
      callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: (err as Error).message
      });
      return;
    }

    const requestId = crypto.randomUUID();
    this._storePendingResponse(requestId, call, callback);

    const cmd = new CreatePeerCmd(
      {
        peerId: peer.getId(),
        http,
        isActive: peer.hasIsActive() ? peer.getIsActive() : undefined,
        maxPacketAmount: peer.hasMaxPacketAmount()
          ? String(peer.getMaxPacketAmount())
          : undefined
      },
      requestId
    );
    await this._msgProducer.send(cmd);
  }

  private async _handleUpdatePeer(
    call: ServerUnaryCall<UpdatePeerRequest, UpdatePeerResponse>,
    callback: sendUnaryData<UpdatePeerResponse>
  ): Promise<void> {
    const peer = call.request.getPeer();
    if (!peer) {
      callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: 'peer is required'
      });
      return;
    }

    let http: IPeer['http'];
    try {
      http = this._pbHttpToDomain(peer.getHttp());
    } catch (err) {
      callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: (err as Error).message
      });
      return;
    }

    const requestId = crypto.randomUUID();
    this._storePendingResponse(requestId, call, callback);

    const cmd = new UpdatePeerCmd(
      {
        peerId: peer.getId(),
        http,
        isActive: peer.hasIsActive() ? peer.getIsActive() : undefined,
        maxPacketAmount: peer.hasMaxPacketAmount()
          ? String(peer.getMaxPacketAmount())
          : undefined
      },
      requestId
    );
    await this._msgProducer.send(cmd);
  }

  private async _handleGetPeer(
    call: ServerUnaryCall<GetPeerRequest, GetPeerResponse>,
    callback: sendUnaryData<GetPeerResponse>
  ): Promise<void> {
    try {
      const peer = await this._peerRepo.fetchById(call.request.getId());
      const response = new GetPeerResponse();
      if (peer) {
        response.setPeer(this._domainToPbPeer(peer));
      }
      callback(null, response);
    } catch (err) {
      callback({ code: grpc.status.INTERNAL, message: (err as Error).message });
    }
  }

  private async _handleListPeers(
    call: ServerUnaryCall<ListPeersRequest, ListPeersResponse>,
    callback: sendUnaryData<ListPeersResponse>
  ): Promise<void> {
    try {
      const peers = await this._peerRepo.fetchAll();
      const response = new ListPeersResponse().setPeersList(
        peers.map((peer) => this._domainToPbPeer(peer))
      );
      callback(null, response);
    } catch (err) {
      callback({ code: grpc.status.INTERNAL, message: (err as Error).message });
    }
  }

  private _pbHttpToDomain(http: PeerHttpSettings | undefined): IPeer['http'] {
    if (!http) {
      throw new Error('peer.http is required');
    }
    const outgoing = http.getOutgoing();
    if (!outgoing) {
      throw new Error('peer.http.outgoing is required');
    }
    if (!outgoing.getCallbackEndpoint()) {
      throw new Error('peer.http.outgoing.callbackEndpoint is required');
    }
    const incoming = http.getIncoming();

    return {
      outgoing: {
        endpoint: outgoing.getEndpoint(),
        callbackEndpoint: outgoing.getCallbackEndpoint(),
        authToken: outgoing.getAuthToken()
      },
      ...(incoming
        ? { incoming: { authToken: incoming.getAuthToken() || undefined } }
        : {})
    };
  }

  private _domainToPbPeer(peer: IPeer): PbPeer {
    const outgoing = new PeerHttpOutgoingSettings()
      .setEndpoint(peer.http.outgoing.endpoint)
      .setCallbackEndpoint(peer.http.outgoing.callbackEndpoint)
      .setAuthToken(peer.http.outgoing.authToken);

    const http = new PeerHttpSettings().setOutgoing(outgoing);
    if (peer.http.incoming?.authToken !== undefined) {
      http.setIncoming(
        new PeerHttpIncomingSettings().setAuthToken(
          peer.http.incoming.authToken
        )
      );
    }

    const pbPeer = new PbPeer().setId(peer.peerId).setHttp(http);
    if (peer.isActive !== undefined) {
      pbPeer.setIsActive(peer.isActive);
    }
    if (peer.maxPacketAmount !== undefined) {
      // jspb uint64 accepts string at runtime; preserves full range.
      pbPeer.setMaxPacketAmount(peer.maxPacketAmount as unknown as number);
    }
    return pbPeer;
  }

  private _storePendingResponse(
    requestId: string,
    call: ServerUnaryCall<any, any>,
    callback: sendUnaryData<any>
  ): void {
    const deadline = call.getDeadline();
    let timeoutMs: number;

    if (deadline instanceof Date) {
      timeoutMs = deadline.getTime() - Date.now();
    } else if (typeof deadline === 'number' && deadline !== Infinity) {
      timeoutMs = deadline - Date.now();
    } else {
      timeoutMs = this._responseTimeoutMs;
    }

    timeoutMs = Math.max(timeoutMs, 0);

    const timer = setTimeout(() => {
      const pending = this._responseMap.get(requestId);
      if (pending) {
        this._responseMap.delete(requestId);
        pending.callback({
          code: grpc.status.DEADLINE_EXCEEDED,
          message: 'Response timeout exceeded'
        });
      }
    }, timeoutMs);

    this._responseMap.set(requestId, { callback, timer });
  }

  private async _handleBatch(messages: IMessage[]): Promise<void> {
    for (const message of messages) {
      await this._handleResponseEvent(message);
    }
  }

  private async _handleResponseEvent(message: IMessage): Promise<void> {
    const requestId = message.requestId;
    if (!requestId) return;

    const pending = this._responseMap.get(requestId);
    if (!pending) return;

    if (message.msgName === ILPPeerCreatedEvent.name) {
      const evt = message as ILPPeerCreatedEvent;
      const response = new CreatePeerResponse().setPeer(
        this._domainToPbPeer({
          peerId: evt.payload.peerId,
          http: evt.payload.http,
          isActive: evt.payload.isActive,
          maxPacketAmount: evt.payload.maxPacketAmount
        })
      );
      this._resolvePendingResponse(pending, requestId, null, response);
    } else if (message.msgName === ILPPeerCreationFailedEvent.name) {
      const evt = message as ILPPeerCreationFailedEvent;
      this._resolvePendingResponse(pending, requestId, {
        code:
          evt.payload.errorName === 'DuplicatePeer'
            ? grpc.status.ALREADY_EXISTS
            : grpc.status.INTERNAL,
        message: evt.payload.message,
        details: evt.payload.message,
        name: evt.payload.errorName,
        metadata: new grpc.Metadata()
      });
    } else if (message.msgName === ILPPeerUpdatedEvent.name) {
      const evt = message as ILPPeerUpdatedEvent;
      const response = new UpdatePeerResponse().setPeer(
        this._domainToPbPeer({
          peerId: evt.payload.peerId,
          http: evt.payload.http,
          isActive: evt.payload.isActive,
          maxPacketAmount: evt.payload.maxPacketAmount
        })
      );
      this._resolvePendingResponse(pending, requestId, null, response);
    } else if (message.msgName === ILPPeerUpdateFailedEvent.name) {
      const evt = message as ILPPeerUpdateFailedEvent;
      this._resolvePendingResponse(pending, requestId, {
        code:
          evt.payload.errorName === 'UnknownPeer'
            ? grpc.status.NOT_FOUND
            : grpc.status.INTERNAL,
        message: evt.payload.message,
        details: evt.payload.message,
        name: evt.payload.errorName,
        metadata: new grpc.Metadata()
      });
    } else {
      this._logger.warn(
        `Unknown response event — msgName: ${message.msgName}, requestId: ${requestId}`
      );
    }
  }

  private _resolvePendingResponse(
    pending: PendingResponse,
    requestId: string,
    error: grpc.ServiceError | null,
    response?: any
  ): void {
    clearTimeout(pending.timer);
    this._responseMap.delete(requestId);
    pending.callback(error, response);
  }
}
