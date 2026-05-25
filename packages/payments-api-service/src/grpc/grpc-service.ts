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
  CreateIncomingPaymentRequest,
  CreateIncomingPaymentResponse,
  CreateQuoteRequest,
  CreateQuoteResponse,
  CreateOutgoingPaymentRequest,
  CreateOutgoingPaymentResponse,
  ApproveOutgoingPaymentRequest,
  ApproveOutgoingPaymentResponse,
  GetPaymentIntentRequest,
  GetPaymentIntentResponse,
  HealthCheckRequest,
  HealthCheckResponse,
  HealthService,
  PaymentsGrpcService
} from 'payments-public-types-lib';
import { IPaymentIntentRepository } from 'payments-domain-lib';
import {
  ILogger,
  IMessage,
  IMessageConsumer,
  IMessageProducer
} from 'common-types-lib';
import {
  CreatePaymentIntentCmd,
  CreateQuoteCmd,
  CreatePaymentCmd,
  ApprovePaymentCmd,
  PaymentIntentDomainEvent
} from 'payments-domain-lib';

const PUBLIC_TYPES_LIB_PATH = require.resolve('payments-public-types-lib');

const DEFAULT_RESPONSE_TIMEOUT_MS = 120_000; // 2 minutes;

interface PendingResponse {
  callback: sendUnaryData<any>;
  timer: ReturnType<typeof setTimeout>;
}

export class PaymentsServiceServer {
  private readonly _instanceId: string;
  private readonly _serverUrl: string;
  private readonly _server: grpc.Server;
  private readonly _msgProducer: IMessageProducer;
  private readonly _msgConsumer: IMessageConsumer;
  private readonly _repo: IPaymentIntentRepository;
  private readonly _responseTimeoutMs: number;
  // Holds pending gRPC callbacks keyed by command ID (UUID).
  // Kafka consumer resolves/rejects these when response events arrive.
  // Entries are cleaned up on response or when the deadline expires.
  private readonly _responseMap: Map<string, PendingResponse> = new Map();
  private readonly _logger: ILogger;
  private _startedAt: number = 0;
  private _terminating: boolean = false;

  constructor(
    instanceId: string,
    serverUrl: string,
    msgProducer: IMessageProducer,
    msgConsumer: IMessageConsumer,
    repo: IPaymentIntentRepository,
    logger: ILogger,
    responseTimeoutMs: number = DEFAULT_RESPONSE_TIMEOUT_MS
  ) {
    this._logger = logger;
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

    // reflection
    const protoDirPath = join(
      path.dirname(PUBLIC_TYPES_LIB_PATH),
      '/proto_files/'
    );
    const protoFilePath = join(protoDirPath, 'payments-svc.proto');
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

    // payments service RPCs
    this._server.addService(PaymentsGrpcService, {
      createIncomingPayment: this._handleUnary.bind(this),
      createQuote: this._handleUnary.bind(this),
      createOutgoingPayment: this._handleUnary.bind(this),
      approveOutgoingPayment: this._handleUnary.bind(this),
      getPaymentIntent: this._handleGetPaymentIntent.bind(this)
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const credentials = grpc.ServerCredentials.createInsecure();
      this._logger.info(
        `Starting Payments GRPC service at: ${this._serverUrl}...`
      );

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

  // health check handlers
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

  private static readonly UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  private async _handleUnary(
    call: ServerUnaryCall<any, any>,
    callback: sendUnaryData<any>
  ): Promise<void> {
    if (call.request instanceof CreateIncomingPaymentRequest) {
      const commandId = call.request.getId();
      if (!PaymentsServiceServer.UUID_REGEX.test(commandId)) {
        callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'id must be a valid UUID'
        });
        return;
      }
      this._storePendingResponse(commandId, call, callback);
      const cmd = new CreatePaymentIntentCmd(
        {
          id: commandId,
          receiverWalletAddressId: call.request.getWalletAddressId(),
          receiverWalletAddress: call.request.getWalletAddress(),
          incomingAmount: call.request.getIncomingAmount(),
          expiresAt: call.request.getExpiresAt(),
          metadata: call.request.getMetadata()
        },
        commandId
      );
      await this._msgProducer.send(cmd);
    } else if (call.request instanceof CreateQuoteRequest) {
      const commandId = call.request.getId();
      if (!PaymentsServiceServer.UUID_REGEX.test(commandId)) {
        callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'id must be a valid UUID'
        });
        return;
      }
      this._storePendingResponse(commandId, call, callback);
      const receiveAmount = call.request.getReceiveAmount();
      const debitAmount = call.request.getDebitAmount();
      const remoteUrl = call.request.getRemoteUrl();
      const cmd = new CreateQuoteCmd(
        {
          id: commandId,
          paymentIntentId: call.request.getIncomingPaymentId(),
          senderWalletAddressId: call.request.getWalletAddressId(),
          senderWalletAddress: call.request.getWalletAddress(),
          receiveAmount: receiveAmount ? receiveAmount : undefined,
          debitAmount: debitAmount ? debitAmount : undefined,
          remoteUrl: remoteUrl ? remoteUrl : undefined
        },
        commandId
      );
      await this._msgProducer.send(cmd);
    } else if (call.request instanceof CreateOutgoingPaymentRequest) {
      const commandId = call.request.getId();
      if (!PaymentsServiceServer.UUID_REGEX.test(commandId)) {
        callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'id must be a valid UUID'
        });
        return;
      }
      this._storePendingResponse(commandId, call, callback);
      const cmd = new CreatePaymentCmd(
        {
          id: commandId,
          senderWalletAddressId: call.request.getWalletAddressId(),
          senderWalletAddress: call.request.getWalletAddress(),
          paymentIntentId: call.request.getIncomingPaymentId(),
          quoteId: call.request.getQuoteId(),
          debitAmount: call.request.getDebitAmount() || undefined
        },
        commandId
      );
      await this._msgProducer.send(cmd);
    } else if (call.request instanceof ApproveOutgoingPaymentRequest) {
      const commandId = call.request.getId();
      this._storePendingResponse(commandId, call, callback);
      const cmd = new ApprovePaymentCmd(
        { id: commandId, paymentIntentId: call.request.getIncomingPaymentId() },
        commandId
      );
      await this._msgProducer.send(cmd);
    } else {
      callback(
        new Error(`Invalid request type: ${call.request.constructor.name}`)
      );
    }
  }

  private async _handleGetPaymentIntent(
    call: ServerUnaryCall<GetPaymentIntentRequest, GetPaymentIntentResponse>,
    callback: sendUnaryData<GetPaymentIntentResponse>
  ): Promise<void> {
    const id = call.request.getId();
    try {
      const paymentIntent = await this._repo.fetchById(id);
      if (!paymentIntent) {
        callback({
          code: grpc.status.NOT_FOUND,
          message: `Payment intent '${id}' not found`
        });
        return;
      }

      const response = new GetPaymentIntentResponse();
      response.setId(paymentIntent.id);
      response.setWalletAddress(paymentIntent.receiverWalletAddress);
      response.setState(paymentIntent.state);
      response.setDestination(paymentIntent.destination);
      response.setReceivedAmount(Number(paymentIntent.receivedAmount));
      response.setAssetCode(paymentIntent.assetCode);
      response.setAssetScale(paymentIntent.assetScale);
      if (paymentIntent.incomingAmount != null) {
        response.setIncomingAmount(Number(paymentIntent.incomingAmount));
      }
      if (paymentIntent.expiresAt) {
        response.setExpiresAt(new Date(paymentIntent.expiresAt).toISOString());
      }
      if (paymentIntent.destinationIlpAddress) {
        response.setDestinationIlpAddress(paymentIntent.destinationIlpAddress);
      }

      callback(null, response);
    } catch (err) {
      callback({ code: grpc.status.INTERNAL, message: (err as Error).message });
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

    // Ensure at least a minimal timeout
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

    this._responseMap.set(commandId, { callback, timer });
  }

  private async _handleBatch(messages: IMessage[]): Promise<void> {
    for (const message of messages) {
      await this._handleResponseEvent(message);
    }
  }

  private async _handleResponseEvent(message: IMessage): Promise<void> {
    const requestId = message.requestId;
    if (!requestId) return;

    // Not ours — different API instance holds the pending callback
    const pending = this._responseMap.get(requestId);
    if (!pending) return;

    const evt = message as PaymentIntentDomainEvent;

    if (PaymentIntentDomainEvent.isPaymentIntentCreatedEvent(evt)) {
      const response = new CreateIncomingPaymentResponse().setId(
        evt.payload.id
      );
      this._resolvePendingResponse(pending, requestId, null, response);
    } else if (PaymentIntentDomainEvent.isPaymentIntentCreateFailedEvent(evt)) {
      this._resolvePendingResponse(pending, requestId, {
        code: grpc.status.INTERNAL,
        message: evt.payload.message || 'Command processing failed',
        details: evt.payload.message,
        name: evt.payload.errorName || 'CommandError',
        metadata: new grpc.Metadata()
      });
    } else if (PaymentIntentDomainEvent.isQuoteCompletedEvent(evt)) {
      const response = new CreateQuoteResponse()
        .setId(evt.payload.id)
        .setPaymentIntentId(evt.payload.paymentIntentId);
      this._resolvePendingResponse(pending, requestId, null, response);
    } else if (PaymentIntentDomainEvent.isQuoteCreateFailedEvent(evt)) {
      this._resolvePendingResponse(pending, requestId, {
        code: grpc.status.INTERNAL,
        message: evt.payload.message || 'Command processing failed',
        details: evt.payload.message,
        name: evt.payload.errorName || 'CommandError',
        metadata: new grpc.Metadata()
      });
    } else if (PaymentIntentDomainEvent.isPaymentCreatedEvent(evt)) {
      const response = new CreateOutgoingPaymentResponse().setId(
        evt.payload.id
      );
      this._resolvePendingResponse(pending, requestId, null, response);
    } else if (PaymentIntentDomainEvent.isPaymentCreateFailedEvent(evt)) {
      this._resolvePendingResponse(pending, requestId, {
        code: grpc.status.INTERNAL,
        message: evt.payload.message || 'Command processing failed',
        details: evt.payload.message,
        name: evt.payload.errorName || 'CommandError',
        metadata: new grpc.Metadata()
      });
    } else if (PaymentIntentDomainEvent.isLocalPaymentCompletedEvent(evt)) {
      const response = new ApproveOutgoingPaymentResponse().setId(
        evt.payload.id
      );
      this._resolvePendingResponse(pending, requestId, null, response);
    } else if (
      PaymentIntentDomainEvent.isLocalPaymentCompleteFailedEvent(evt)
    ) {
      this._resolvePendingResponse(pending, requestId, {
        code: grpc.status.INTERNAL,
        message: evt.payload.message || 'Command processing failed',
        details: evt.payload.message,
        name: evt.payload.errorName || 'CommandError',
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
    commandId: string,
    error: grpc.ServiceError | null,
    response?: any
  ): void {
    clearTimeout(pending.timer);
    this._responseMap.delete(commandId);
    pending.callback(error, response);
  }
}
