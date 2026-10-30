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
  RhyzaAuthService,
  HealthService,
  HealthCheckRequest,
  HealthCheckResponse,
  GrantRequest,
  CreateGrantResponse,
  ContinueGrantRequest,
  RevokeGrantRequest,
  AdminRevokeGrantRequest,
  IntrospectTokenRequest,
  RotateTokenRequest,
  RevokeTokenRequest,
  StartInteractionRequest,
  StartInteractionResponse,
  AcceptInteractionRequest,
  RejectInteractionRequest,
  GetGrantRequest,
  GetGrantsPageRequest,
  GetGrantsPageResponse,
  SortOrder as PbSortOrder,
  AccessItem,
  AccessLimits,
  SubjectId,
  Interaction,
  ContinueGrantResponse,
  RevokeGrantResponse,
  RevokeTokenResponse,
  IntrospectTokenResponse,
  RotateTokenResponse,
  Grant,
  FinishInteractionRequest,
  FinishInteractionResponse,
  HandleInteractionChoiceResponse
} from 'auth-public-types-lib';

import {
  IMessage,
  IMessageConsumer,
  IMessageProducer,
  InvalidArgument,
  DEFAULT_SORT_ORDER,
  SortOrder
} from 'common-types-lib';
import { decodeCursor, encodeCursor } from 'implementations-lib';
import { CursorContext } from './cursor';
import {
  CreateGrantCmd,
  ContinueGrantCmd,
  RevokeGrantCmd,
  AdminRevokeGrantCmd,
  RotateTokenCmd,
  RevokeTokenCmd,
  AcceptInteractionCmd,
  RejectInteractionCmd,
  GrantCreateFailedEvent,
  GrantContinuedEvent,
  GrantContinueFailedEvent,
  IntrospectTokenCmd,
  AuthDomainEvent,
  GrantCreatedEvent,
  GrantRevokedEvent,
  GrantRevokeFailedEvent,
  TokenIntrospectedEvent,
  TokenRotatedEvent,
  TokenRotationFailedEvent,
  TokenRevokedEvent,
  TokenRevokeFailedEvent,
  IAccessItem,
  StartInteractionCmd,
  GrantInteractionStartedEvent,
  GrantInteractionStartFailedEvent,
  FinishInteractionCmd,
  GrantInteractionFinishedEvent,
  GrantInteractionFinishFailedEvent,
  GrantInteractionChoiceFailedEvent,
  GrantState,
  IGrant
} from 'auth-domain-lib';
import crypto from 'crypto';
import { IGrantRepository } from 'auth-domain-lib/src';
import { AppErrorType } from 'common-types-lib/src';

const PUBLIC_TYPES_LIB_PATH = require.resolve('auth-public-types-lib');
const DEFAULT_RESPONSE_TIMEOUT_MS = 120_000;

interface PendingResponse {
  callback: sendUnaryData<any>;
  timer: ReturnType<typeof setTimeout>;
}

export class AuthServiceServer {
  private static readonly DEFAULT_PAGE_LIMIT = 20;
  private static readonly MAX_PAGE_LIMIT = 100;
  private readonly _instanceId: string;
  private readonly _serverUrl: string;
  private readonly _server: grpc.Server;
  private readonly _msgProducer: IMessageProducer;
  private readonly _msgConsumer: IMessageConsumer;
  private readonly _repo: IGrantRepository;
  private readonly _responseTimeoutMs: number;
  private readonly _responseMap: Map<string, PendingResponse> = new Map();
  private _startedAt: number = 0;
  private _terminating: boolean = false;

  constructor(
    instanceId: string,
    serverUrl: string,
    msgProducer: IMessageProducer,
    msgConsumer: IMessageConsumer,
    repo: IGrantRepository,
    responseTimeoutMs: number = DEFAULT_RESPONSE_TIMEOUT_MS
  ) {
    this._responseTimeoutMs = responseTimeoutMs;
    this._serverUrl = serverUrl;
    this._instanceId = instanceId;
    this._msgProducer = msgProducer;
    this._msgConsumer = msgConsumer;
    this._repo = repo;

    this._msgConsumer.setBatchCallbackFn(this._handleBatch.bind(this));

    this._server = new grpc.Server({
      'grpc.max_concurrent_streams': 100,
      'grpc.max_connection_age_grace_ms': 60_000,
      'grpc.keepalive_time_ms': 10_000,
      'grpc.keepalive_timeout_ms': 5_000,
      'grpc.keepalive_permit_without_calls': 1
    });

    const protoDirPath = join(
      path.dirname(PUBLIC_TYPES_LIB_PATH),
      '/proto_files/'
    );
    const protoFilePath = join(protoDirPath, 'auth-svc.proto');
    const packageDefinition = protoLoader.loadSync(protoFilePath, {
      includeDirs: [protoDirPath]
    });
    const reflection = new ReflectionService(packageDefinition);
    reflection.addToServer(this._server);

    this._server.addService(HealthService, {
      check: this._handleUnaryHealthCheck.bind(this),
      watch: this._handleHealthWatchStream.bind(this)
    });

    this._server.addService(RhyzaAuthService, {
      createGrant: this._handleUnary.bind(this),
      continueGrant: this._handleUnary.bind(this),
      revokeGrant: this._handleUnary.bind(this),
      adminRevokeGrant: this._handleUnary.bind(this),
      introspectToken: this._handleUnary.bind(this),
      rotateToken: this._handleUnary.bind(this),
      revokeToken: this._handleUnary.bind(this),
      startInteraction: this._handleUnary.bind(this),
      finishInteraction: this._handleUnary.bind(this),
      getGrant: this._handleGetGrant.bind(this),
      getGrantsPage: this._handleGetGrantsPage.bind(this),
      acceptInteraction: this._handleUnary.bind(this),
      rejectInteraction: this._handleUnary.bind(this)
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const credentials = grpc.ServerCredentials.createInsecure();
      console.info(`Starting Auth GRPC service at: ${this._serverUrl}...`);

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

  private getAccessListResponse(accessItem: IAccessItem): AccessItem {
    const responseAccessItem = new AccessItem();
    responseAccessItem.setType(accessItem.type);
    responseAccessItem.setActionsList(accessItem.actions);
    if (accessItem.identifier) {
      responseAccessItem.setIdentifier(accessItem.identifier);
    }

    if (accessItem.limits) {
      const limits = new AccessLimits();
      limits.setReceiver(accessItem.limits.receiver);
      if (accessItem.limits.receiveAmount) {
        limits.setReceiveAmountValue(String(accessItem.limits.receiveAmount));
      }
      if (accessItem.limits.debitAmount) {
        limits.setDebitAmountValue(String(accessItem.limits.debitAmount));
      }
      if (accessItem.limits.assetCode) {
        limits.setAssetCode(accessItem.limits.assetCode);
      }
      if (accessItem.limits.assetScale) {
        limits.setAssetScale(accessItem.limits.assetScale);
      }
      if (accessItem.limits.interval) {
        limits.setInterval(accessItem.limits.interval);
      }
      responseAccessItem.setLimits(limits);
    }
    return responseAccessItem;
  }

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

  private async _handleUnary(
    call: ServerUnaryCall<any, any>,
    callback: sendUnaryData<any>
  ): Promise<void> {
    if (call.request instanceof GrantRequest) {
      const commandId = crypto.randomUUID();
      this._storePendingResponse(commandId, call, callback);

      // TODO: factor out getting access list from multiple handlers.
      const accessList = call.request.getAccessList().map((item: any) => ({
        type: item.getType().toString(),
        actions: item.getActionsList().map((a: any) => a.toString()),
        identifier: item.getIdentifier(),
        limits: item.getLimits()
          ? {
              receiver: item.getLimits().getReceiver(),
              assetCode: item.getLimits().getAssetCode(),
              assetScale: item.getLimits().getAssetScale(),
              debitAmount: item.getLimits().getDebitAmountValue(),
              receiveAmount: item.getLimits().getReceiveAmountValue(),
              interval: item.getLimits().getInterval()
            }
          : undefined
      }));

      const subjectIds = call.request
        .getSubjectIdsList()
        .map((s: any) => ({ format: s.getFormat(), id: s.getId() }));

      const finishObj = call.request.getFinish();
      const finish = finishObj
        ? {
            method: finishObj.getFinish().toString(),
            uri: finishObj.getUri(),
            nonce: finishObj.getNonce()
          }
        : undefined;

      const startMethods = call.request
        .getStartList()
        .map((s: any) => s.toString());

      const signatureDataMsg = call.request.getSignatureData();
      if (!signatureDataMsg) {
        callback(new Error('Missing signature data'));
        return;
      }
      const signatureData = {
        url: signatureDataMsg.getUrl(),
        method: signatureDataMsg.getMethod(),
        body: signatureDataMsg.getBody(),
        headers: JSON.parse(signatureDataMsg.getHeaders()),
        kid: signatureDataMsg.getKid()
      };

      const cmd = new CreateGrantCmd(
        {
          id: commandId,
          access: accessList,
          client: call.request.getClient(),
          signatureData,
          subjectIds: subjectIds,
          interact: finish
            ? { start: startMethods, finish }
            : { start: startMethods }
        },
        commandId
      );
      await this._msgProducer.send(cmd);
    } else if (call.request instanceof ContinueGrantRequest) {
      const commandId = crypto.randomUUID();
      this._storePendingResponse(commandId, call, callback);

      const signatureDataMsg = call.request.getSignatureData();
      if (!signatureDataMsg) {
        callback(new Error('Missing signature data'));
        return;
      }
      const signatureData = {
        url: signatureDataMsg.getUrl(),
        method: signatureDataMsg.getMethod(),
        body: signatureDataMsg.getBody(),
        headers: JSON.parse(signatureDataMsg.getHeaders()),
        kid: signatureDataMsg.getKid()
      };

      const cmd = new ContinueGrantCmd(
        {
          id: call.request.getId(),
          continueId: call.request.getContinueId(),
          continueToken: call.request.getContinueToken(),
          interactRef: call.request.getInteractRef() || undefined,
          signatureData
        },
        commandId
      );
      await this._msgProducer.send(cmd);
    } else if (call.request instanceof RevokeGrantRequest) {
      const commandId = crypto.randomUUID();
      this._storePendingResponse(commandId, call, callback);

      const signatureDataMsg = call.request.getSignatureData();
      if (!signatureDataMsg) {
        callback(new Error('Missing signature data'));
        return;
      }
      const signatureData = {
        url: signatureDataMsg.getUrl(),
        method: signatureDataMsg.getMethod(),
        body: signatureDataMsg.getBody(),
        headers: JSON.parse(signatureDataMsg.getHeaders()),
        kid: signatureDataMsg.getKid()
      };

      const cmd = new RevokeGrantCmd(
        {
          id: call.request.getId(),
          continueId: call.request.getContinueId(),
          continueToken: call.request.getContinueToken(),
          signatureData
        },
        commandId
      );
      await this._msgProducer.send(cmd);
    } else if (call.request instanceof AdminRevokeGrantRequest) {
      const commandId = crypto.randomUUID();
      this._storePendingResponse(commandId, call, callback);

      const cmd = new AdminRevokeGrantCmd(
        {
          id: call.request.getId()
        },
        commandId
      );
      await this._msgProducer.send(cmd);
    } else if (call.request instanceof AcceptInteractionRequest) {
      const commandId = crypto.randomUUID();
      this._storePendingResponse(commandId, call, callback);

      const cmd = new AcceptInteractionCmd(
        {
          id: call.request.getId()
        },
        commandId
      );
      await this._msgProducer.send(cmd);
    } else if (call.request instanceof RejectInteractionRequest) {
      const commandId = crypto.randomUUID();
      this._storePendingResponse(commandId, call, callback);

      const cmd = new RejectInteractionCmd(
        {
          id: call.request.getId()
        },
        commandId
      );
      await this._msgProducer.send(cmd);
    } else if (call.request instanceof StartInteractionRequest) {
      const commandId = crypto.randomUUID();
      this._storePendingResponse(commandId, call, callback);

      const cmd = new StartInteractionCmd(
        {
          id: call.request.getId()
        },
        commandId
      );
      await this._msgProducer.send(cmd);
    } else if (call.request instanceof FinishInteractionRequest) {
      const commandId = crypto.randomUUID();
      this._storePendingResponse(commandId, call, callback);

      const cmd = new FinishInteractionCmd(
        {
          id: call.request.getId(),
          nonce: call.request.getNonce()
        },
        commandId
      );
      await this._msgProducer.send(cmd);
    } else if (call.request instanceof IntrospectTokenRequest) {
      const commandId = crypto.randomUUID();
      this._storePendingResponse(commandId, call, callback);

      const cmd = new IntrospectTokenCmd(
        {
          id: call.request.getId(),
          tokenValue: call.request.getTokenValue(),
          access: call.request.getAccessList().map((item: any) => ({
            type: item.getType().toString(),
            actions: item.getActionsList().map((a: any) => a.toString()),
            identifier: item.getIdentifier(),
            limits: item.getLimits()
              ? {
                  receiver: item.getLimits().getReceiver(),
                  assetCode: item.getLimits().getAssetCode(),
                  assetScale: item.getLimits().getAssetScale(),
                  debitAmount: item.getLimits().getDebitAmountValue(),
                  receiveAmount: item.getLimits().getReceiveAmountValue(),
                  interval: item.getLimits().getInterval()
                }
              : undefined
          }))
        },
        commandId
      );
      await this._msgProducer.send(cmd);
    } else if (call.request instanceof RotateTokenRequest) {
      const commandId = crypto.randomUUID();
      this._storePendingResponse(commandId, call, callback);

      const signatureDataMsg = call.request.getSignatureData();
      if (!signatureDataMsg) {
        callback(new Error('Missing signature data'));
        return;
      }
      const signatureData = {
        url: signatureDataMsg.getUrl(),
        method: signatureDataMsg.getMethod(),
        body: signatureDataMsg.getBody(),
        headers: JSON.parse(signatureDataMsg.getHeaders()),
        kid: signatureDataMsg.getKid()
      };

      const cmd = new RotateTokenCmd(
        {
          id: call.request.getId(),
          value: call.request.getTokenValue(),
          managementId: call.request.getManagementId(),
          signatureData
        },
        commandId
      );
      await this._msgProducer.send(cmd);
    } else if (call.request instanceof RevokeTokenRequest) {
      const commandId = crypto.randomUUID();
      this._storePendingResponse(commandId, call, callback);

      const signatureDataMsg = call.request.getSignatureData();
      if (!signatureDataMsg) {
        callback(new Error('Missing signature data'));
        return;
      }
      const signatureData = {
        url: signatureDataMsg.getUrl(),
        method: signatureDataMsg.getMethod(),
        body: signatureDataMsg.getBody(),
        headers: JSON.parse(signatureDataMsg.getHeaders()),
        kid: signatureDataMsg.getKid()
      };

      const cmd = new RevokeTokenCmd(
        {
          id: call.request.getId(),
          value: call.request.getTokenValue(),
          managementId: call.request.getManagementId(),
          signatureData
        },
        commandId
      );
      await this._msgProducer.send(cmd);
    } else {
      callback(
        new Error(`Invalid request type: ${call.request.constructor.name}`)
      );
    }
  }

  private _toPbGrant(grant: IGrant): Grant {
    const response = new Grant();
    response.setId(grant.id);
    response.setState(grant.state);
    response.setCreatedAt(new Date(grant.createdAt).toISOString());

    if (grant.startMethods) {
      response.setStartMethodsList(grant.startMethods);
    }

    if (grant.continueToken) {
      response.setContinueToken(grant.continueToken);
      response.setContinueId(grant.id);
    }

    if (grant.client) {
      const serializedClient =
        typeof grant.client === 'string'
          ? grant.client
          : JSON.stringify(grant.client);
      response.setClient(serializedClient);
    }

    if (grant.subjectIds) {
      for (const sub of grant.subjectIds) {
        const subItem = new SubjectId();
        subItem.setId(sub.id);
        subItem.setFormat(sub.format);
        response.addSubjectIds(subItem);
      }
    }

    for (const access of grant.accesses || []) {
      response.addAccesses(this.getAccessListResponse(access));
    }

    if (grant.finishNonce) response.setFinishNonce(grant.finishNonce);

    if (grant.finishUri) response.setFinishUri(grant.finishUri);

    if (grant.finishMethod) response.setFinishMethod(grant.finishMethod);

    if (grant.interaction) {
      const interaction = new Interaction();
      interaction.setExpiresAt(grant.interaction.expiresAt.getTime());
      interaction.setState(grant.interaction.state);
      interaction.setInteractRef(grant.interaction.interactRef);
      response.setInteraction(interaction);
    }

    return response;
  }

  private async _handleGetGrantsPage(
    call: ServerUnaryCall<GetGrantsPageRequest, GetGrantsPageResponse>,
    callback: sendUnaryData<GetGrantsPageResponse>
  ): Promise<void> {
    try {
      const request = call.request;
      const cursorContext: CursorContext = {
        sortOrder: this._pageSortOrder(request.getSortOrder()),
        identifier: request.getIdentifier() || undefined,
        state: (request.getState() || undefined) as GrantState | undefined
      };
      const cursor = request.getCursor() || undefined;

      const page = await this._repo.fetchGrantsPage({
        identifier: cursorContext.identifier,
        state: cursorContext.state,
        cursor: cursor && decodeCursor(cursor, cursorContext),
        limit: this._clampPageLimit(request.getLimit()),
        backwards: request.getBackwards(),
        sortOrder: cursorContext.sortOrder
      });

      const response = new GetGrantsPageResponse();
      response.setGrantsList(page.items.map((grant) => this._toPbGrant(grant)));
      response.setHasNextPage(page.hasNextPage);
      response.setHasPreviousPage(page.hasPreviousPage);
      if (page.items.length > 0) {
        response.setStartCursor(encodeCursor(page.items[0].id, cursorContext));
        response.setEndCursor(
          encodeCursor(page.items[page.items.length - 1].id, cursorContext)
        );
      }

      callback(null, response);
    } catch (err) {
      callback(this._pageErrorToStatus(err));
    }
  }

  private _clampPageLimit(limit: number): number {
    if (!limit) return AuthServiceServer.DEFAULT_PAGE_LIMIT;
    return Math.min(limit, AuthServiceServer.MAX_PAGE_LIMIT);
  }

  private _pageSortOrder(sortOrder: PbSortOrder): SortOrder {
    switch (sortOrder) {
      case PbSortOrder.SORT_ORDER_ASC:
        return 'asc';
      case PbSortOrder.SORT_ORDER_DESC:
        return 'desc';
      default:
        return DEFAULT_SORT_ORDER;
    }
  }

  private _pageErrorToStatus(err: unknown): grpc.ServiceError {
    if (err instanceof InvalidArgument) {
      return {
        code: grpc.status.INVALID_ARGUMENT,
        message: (err as Error).message
      } as grpc.ServiceError;
    }
    return {
      code: grpc.status.INTERNAL,
      message: (err as Error).message
    } as grpc.ServiceError;
  }

  private async _handleGetGrant(
    call: ServerUnaryCall<GetGrantRequest, Grant>,
    callback: sendUnaryData<Grant>
  ): Promise<void> {
    const id = call.request.getId();
    try {
      const [grant] = await this._repo.fetchByIds([id]);
      if (!grant) {
        callback({
          code: grpc.status.NOT_FOUND,
          message: `Grant '${id}' not found`
        });
        return;
      }

      callback(null, this._toPbGrant(grant));
    } catch (err) {
      callback({
        code: grpc.status.INTERNAL,
        message: (err as Error).message
      });
    }
  }

  private _storePendingResponse(
    commandId: string,
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
      const pending = this._responseMap.get(commandId);
      if (pending) {
        this._responseMap.delete(commandId);
        pending.callback({
          code: grpc.status.DEADLINE_EXCEEDED,
          message: 'Response timeout exceeded'
        });
      }
    }, timeoutMs);

    this._responseMap.set(commandId, {
      callback,
      timer
    });
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

    const event = message as AuthDomainEvent;

    if (AuthDomainEvent.isGrantCreatedEvent(event)) {
      const response = new CreateGrantResponse();
      const payload: GrantCreatedEvent['payload'] = event.payload;
      response.setId(payload.id);

      if (payload.interactionNonce) {
        response.setInteractionNonce(payload.interactionNonce);
      }

      if (payload.continueToken) {
        response.setContinueToken(payload.continueToken);
      }
      if (payload.continueId) {
        response.setContinueId(payload.continueId);
      }

      if (payload.accessTokenValue) {
        response.setAccessTokenValue(payload.accessTokenValue);
      }
      if (payload.accessTokenManagementId) {
        response.setAccessTokenManagementId(payload.accessTokenManagementId);
      }
      if (payload.accessTokenExpiresIn) {
        response.setAccessTokenExpiresIn(payload.accessTokenExpiresIn);
      }

      for (const access of payload.access || []) {
        response.addAccess(this.getAccessListResponse(access));
      }

      if (payload.subjectIds) {
        for (const sub of payload.subjectIds) {
          const subItem = new SubjectId();
          subItem.setId(sub.id);
          subItem.setFormat(sub.format);
          response.addSubIds(subItem);
        }
      }

      this._resolvePendingResponse(pending, requestId, null, response);
    } else if (AuthDomainEvent.isGrantCreateFailedEvent(event)) {
      const payload: GrantCreateFailedEvent['payload'] = event.payload;
      this._resolvePendingResponse(
        pending,
        requestId,
        this._toServiceError(payload)
      );
    } else if (AuthDomainEvent.isGrantContinuedEvent(event)) {
      const response = new ContinueGrantResponse();
      const payload: GrantContinuedEvent['payload'] = event.payload;

      response.setId(payload.id);
      response.setState(payload.state);

      if (payload.accessTokenValue) {
        response.setAccessTokenValue(payload.accessTokenValue);
      }

      if (payload.accessTokenManagementId) {
        response.setAccessTokenManagementId(payload.accessTokenManagementId);
      }

      if (payload.accessTokenExpiresIn) {
        response.setAccessTokenExpiresIn(payload.accessTokenExpiresIn);
      }

      for (const access of payload.access || []) {
        response.addAccess(this.getAccessListResponse(access));
      }

      if (payload.continueId) {
        response.setContinueId(payload.continueId);
      }

      if (payload.continueToken) {
        response.setContinueToken(payload.continueToken);
      }
      this._resolvePendingResponse(pending, requestId, null, response);
    } else if (AuthDomainEvent.isGrantContinueFailedEvent(event)) {
      const payload: GrantContinueFailedEvent['payload'] = event.payload;
      this._resolvePendingResponse(
        pending,
        requestId,
        this._toServiceError(payload)
      );
    } else if (AuthDomainEvent.isGrantRevokedEvent(event)) {
      const response = new RevokeGrantResponse();
      const payload: GrantRevokedEvent['payload'] = event.payload;
      response.setId(payload.id);
      this._resolvePendingResponse(pending, requestId, null, response);
    } else if (AuthDomainEvent.isGrantRevokeFailedEvent(event)) {
      const payload: GrantRevokeFailedEvent['payload'] = event.payload;
      this._resolvePendingResponse(
        pending,
        requestId,
        this._toServiceError(payload)
      );
    } else if (AuthDomainEvent.isGrantInteractionFinishedEvent(event)) {
      const response = new FinishInteractionResponse();
      const payload: GrantInteractionFinishedEvent['payload'] = event.payload;
      response.setId(payload.id);
      response.setInteractNonce(payload.interactNonce);
      response.setClientNonce(payload.clientNonce);
      response.setInteractRef(payload.interactRef);
      if (payload.clientFinishUri) {
        response.setFinishUri(payload.clientFinishUri);
      }
      this._resolvePendingResponse(pending, requestId, null, response);
    } else if (AuthDomainEvent.isGrantInteractionFinishFailedEvent(event)) {
      const payload: GrantInteractionFinishFailedEvent['payload'] =
        event.payload;
      this._resolvePendingResponse(
        pending,
        requestId,
        this._toServiceError(payload)
      );
    } else if (AuthDomainEvent.isTokenIntrospectedEvent(event)) {
      const response = new IntrospectTokenResponse();
      const payload: TokenIntrospectedEvent['payload'] = event.payload;
      response.setGrantId(payload.id);
      response.setActive(payload.active);
      for (const access of payload.access || []) {
        response.addAccess(this.getAccessListResponse(access));
      }
      this._resolvePendingResponse(pending, requestId, null, response);
    } else if (AuthDomainEvent.isTokenRotatedEvent(event)) {
      const response = new RotateTokenResponse();
      const payload: TokenRotatedEvent['payload'] = event.payload;
      response.setGrantId(payload.id);
      response.setNewAccessTokenValue(payload.newAccessTokenValue);
      response.setNewAccessTokenManagementId(
        payload.newAccessTokenManagementId
      );
      response.setNewAccessTokenExpiresIn(payload.newAccessTokenExpiresIn);
      for (const access of payload.access || []) {
        response.addAccess(this.getAccessListResponse(access));
      }
      this._resolvePendingResponse(pending, requestId, null, response);
    } else if (AuthDomainEvent.isTokenRotationFailedEvent(event)) {
      const payload: TokenRotationFailedEvent['payload'] = event.payload;
      this._resolvePendingResponse(
        pending,
        requestId,
        this._toServiceError(payload)
      );
    } else if (AuthDomainEvent.isTokenRevokedEvent(event)) {
      const response = new RevokeTokenResponse();
      const payload: TokenRevokedEvent['payload'] = event.payload;
      response.setId(payload.id);
      this._resolvePendingResponse(pending, requestId, null, response);
    } else if (AuthDomainEvent.isTokenRevokeFailedEvent(event)) {
      const payload: TokenRevokeFailedEvent['payload'] = event.payload;
      this._resolvePendingResponse(
        pending,
        requestId,
        this._toServiceError(payload)
      );
    } else if (AuthDomainEvent.isGrantInteractionStartedEvent(event)) {
      const response = new StartInteractionResponse();
      const payload: GrantInteractionStartedEvent['payload'] = event.payload;
      response.setId(payload.id);
      response.setNonce(payload.nonce);
      response.setClientUri(payload.clientUri);
      response.setClientName(payload.clientName);
      this._resolvePendingResponse(pending, requestId, null, response);
    } else if (AuthDomainEvent.isGrantInteractionStartFailedEvent(event)) {
      const payload: GrantInteractionStartFailedEvent['payload'] =
        event.payload;
      this._resolvePendingResponse(
        pending,
        requestId,
        this._toServiceError(payload)
      );
    } else if (AuthDomainEvent.isGrantInteractionChoiceHandledEvent(event)) {
      const response = new HandleInteractionChoiceResponse();
      response.setSuccess(true);
      this._resolvePendingResponse(pending, requestId, null, response);
    } else if (AuthDomainEvent.isGrantInteractionChoiceFailedEvent(event)) {
      const payload: GrantInteractionChoiceFailedEvent['payload'] =
        event.payload;
      this._resolvePendingResponse(
        pending,
        requestId,
        this._toServiceError(payload)
      );
    } else {
      console.warn(
        `Unknown response event — msgName: ${message.msgName}, requestId: ${requestId}`
      );
    }
  }

  private _toServiceError(payload: {
    errorName: string;
    errorType: AppErrorType;
    message: string;
  }): grpc.ServiceError {
    return {
      code: this._toGrpcStatus(payload.errorType),
      message: payload.message || 'Command processing failed',
      details: payload.message,
      name: payload.errorName || 'CommandError',
      metadata: new grpc.Metadata()
    };
  }

  private _toGrpcStatus(errorType: AppErrorType): grpc.status {
    switch (errorType) {
      case 'InvalidArgument':
        return grpc.status.INVALID_ARGUMENT;
      case 'NotFound':
        return grpc.status.NOT_FOUND;
      case 'AlreadyExists':
        return grpc.status.ALREADY_EXISTS;
      case 'FailedPrecondition':
        return grpc.status.FAILED_PRECONDITION;
      case 'PermissionDenied':
        return grpc.status.PERMISSION_DENIED;
      case 'Unavailable':
        return grpc.status.UNAVAILABLE;
      case 'Aborted':
        return grpc.status.ABORTED;
      case 'Internal':
      default:
        return grpc.status.INTERNAL;
    }
  }

  private _resolvePendingResponse(
    pending: PendingResponse,
    commandId: string,
    error: grpc.ServiceError | null,
    response?: any
  ): void {
    clearTimeout(pending.timer);
    this._responseMap.delete(commandId);
    pending.callback(error, response);
  }
}
