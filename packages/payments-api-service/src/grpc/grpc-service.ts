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
  CreatePaymentIntentRequest,
  CreatePaymentIntentResponse,
  CompletePaymentIntentRequest,
  CompletePaymentIntentResponse,
  CreateQuoteRequest,
  CreateQuoteResponse,
  CreatePaymentRequest,
  CreatePaymentResponse,
  ApprovePaymentRequest,
  ApprovePaymentResponse,
  CancelPaymentRequest,
  CancelPaymentResponse,
  GetPaymentIntentRequest,
  GetPaymentIntentResponse,
  GetPaymentRequest,
  GetPaymentResponse,
  GetPaymentIntentsPageRequest,
  GetPaymentIntentsPageResponse,
  GetPaymentsPageRequest,
  GetPaymentsPageResponse,
  Amount,
  PaymentIntent,
  Payment,
  HealthCheckRequest,
  HealthCheckResponse,
  HealthService,
  PaymentsGrpcService,
  PaymentIntentDomainEvent,
  GetQuoteRequest,
  GetQuoteResponse,
  SortOrder as PbSortOrder
} from 'payments-public-types-lib';
import { CursorContext, decodeCursor, encodeCursor } from './cursor.js';
import {
  DEFAULT_SORT_ORDER,
  IPaymentIntent,
  IPaymentIntentRepository,
  IStoredSentPayment,
  SortOrder
} from 'payments-domain-lib';
import {
  AppErrorType,
  ILogger,
  IMessage,
  InvalidArgument,
  IMessageConsumer,
  IMessageProducer
} from 'common-types-lib';
import {
  CreatePaymentIntentCmd,
  CompletePaymentIntentCmd,
  CreateQuoteCmd,
  CreatePaymentCmd,
  ApprovePaymentCmd,
  CancelPaymentCmd
} from 'payments-domain-lib';

const PUBLIC_TYPES_LIB_PATH = require.resolve('payments-public-types-lib');

const DEFAULT_RESPONSE_TIMEOUT_MS = 120_000; // 2 minutes;

interface PendingResponse {
  callback: sendUnaryData<any>;
  timer: ReturnType<typeof setTimeout>;
}

export class PaymentsServiceServer {
  private static readonly DEFAULT_PAGE_LIMIT = 20;
  private static readonly MAX_PAGE_LIMIT = 100;
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
      createPaymentIntent: this._handleUnary.bind(this),
      completePaymentIntent: this._handleUnary.bind(this),
      createQuote: this._handleUnary.bind(this),
      createPayment: this._handleUnary.bind(this),
      approvePayment: this._handleUnary.bind(this),
      cancelPayment: this._handleUnary.bind(this),
      getPaymentIntent: this._handleGetPaymentIntent.bind(this),
      getQuote: this._handleGetQuote.bind(this),
      getPayment: this._handleGetPayment.bind(this),
      getPaymentIntentsPage: this._handleGetPaymentIntentsPage.bind(this),
      getPaymentsPage: this._handleGetPaymentsPage.bind(this)
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
    if (call.request instanceof CreatePaymentIntentRequest) {
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
          incomingAmount: call.request.hasIncomingAmount()
            ? call.request.getIncomingAmount()
            : undefined,
          expiresAt: call.request.getExpiresAt(),
          metadata: call.request.getMetadata()
        },
        commandId
      );
      await this._msgProducer.send(cmd);
    } else if (call.request instanceof CompletePaymentIntentRequest) {
      const commandId = call.request.getId();
      if (!PaymentsServiceServer.UUID_REGEX.test(commandId)) {
        callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'id must be a valid UUID'
        });
        return;
      }
      this._storePendingResponse(commandId, call, callback);
      const cmd = new CompletePaymentIntentCmd(
        {
          id: commandId
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
      const remotePaymentIntentUrl = call.request.getRemotePaymentIntentUrl();
      const cmd = new CreateQuoteCmd(
        {
          id: commandId,
          paymentIntentId: call.request.getPaymentIntentId(),
          senderWalletAddressId: call.request.getWalletAddressId(),
          senderWalletAddress: call.request.getWalletAddress(),
          receiveAmount: receiveAmount ? receiveAmount : undefined,
          debitAmount: debitAmount ? debitAmount : undefined,
          remotePaymentIntentUrl: remotePaymentIntentUrl || undefined,
          createdAt: call.request.getCreatedAt() || undefined
        },
        commandId
      );
      await this._msgProducer.send(cmd);
    } else if (call.request instanceof CreatePaymentRequest) {
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
          paymentIntentId: call.request.getPaymentIntentId(),
          quoteId: call.request.getQuoteId(),
          debitAmount: call.request.getDebitAmount() || undefined,
          remotePaymentIntentUrl:
            call.request.getRemotePaymentIntentUrl() || undefined,
          createdAt: call.request.getCreatedAt() || undefined,
          grantId: call.request.getGrantId() || undefined
        },
        commandId
      );
      await this._msgProducer.send(cmd);
    } else if (call.request instanceof ApprovePaymentRequest) {
      const commandId = call.request.getId();
      // Alternative worth considering:
      // respond immediately with 202, dont store and listen for event.
      this._storePendingResponse(commandId, call, callback);
      const cmd = new ApprovePaymentCmd(
        { id: commandId, paymentIntentId: call.request.getPaymentIntentId() },
        commandId
      );
      await this._msgProducer.send(cmd);
    } else if (call.request instanceof CancelPaymentRequest) {
      const commandId = call.request.getId();
      this._storePendingResponse(commandId, call, callback);
      const cmd = new CancelPaymentCmd(
        {
          id: commandId,
          paymentIntentId: call.request.getPaymentIntentId(),
          reason: call.request.getReason()
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

  private async _handleGetPaymentIntent(
    call: ServerUnaryCall<GetPaymentIntentRequest, GetPaymentIntentResponse>,
    callback: sendUnaryData<GetPaymentIntentResponse>
  ): Promise<void> {
    const id = call.request.getId();
    try {
      const [paymentIntent] = await this._repo.fetchByIds([id]);
      if (!paymentIntent) {
        callback({
          code: grpc.status.NOT_FOUND,
          message: `Payment intent '${id}' not found`
        });
        return;
      }

      const response = new GetPaymentIntentResponse();
      response.setPaymentIntent(this._toPbPaymentIntent(paymentIntent));

      callback(null, response);
    } catch (err) {
      callback({ code: grpc.status.INTERNAL, message: (err as Error).message });
    }
  }

  private async _handleGetQuote(
    call: ServerUnaryCall<GetQuoteRequest, GetQuoteResponse>,
    callback: sendUnaryData<GetQuoteResponse>
  ): Promise<void> {
    const paymentIntentId = call.request.getPaymentIntentId();
    const id = call.request.getId();
    try {
      const [paymentIntent] = await this._repo.fetchByIds([paymentIntentId]);
      if (!paymentIntent) {
        callback({
          code: grpc.status.NOT_FOUND,
          message: `Payment intent '${paymentIntentId}' not found`
        });
        return;
      }

      const quote = paymentIntent.quotes.find((q) => q.id === id);
      if (!quote) {
        callback({
          code: grpc.status.NOT_FOUND,
          message: `Quote '${id}' not found`
        });
        return;
      }

      const response = new GetQuoteResponse();
      response.setId(quote.id);
      response.setPaymentIntentId(paymentIntent.id);
      response.setState(quote.state);
      response.setSenderWalletAddress(quote.senderWalletAddress);
      response.setSenderWalletAddressId(quote.senderWalletAddressId);
      response.setCreatedAt(new Date(quote.createdAt).toISOString());

      if (quote.state === 'COMPLETED') {
        response.setExpiresAt(new Date(quote.expiresAt).toISOString());
        response.setDebitAmount(Number(quote.debitAmount));
        response.setReceiveAmount(Number(quote.receiveAmount));
        response.setExchangeRate(quote.exchangeRate);
      } else if (quote.state === 'PENDING') {
        if (quote.debitAmount != null) {
          response.setDebitAmount(Number(quote.debitAmount));
        }
        if (quote.receiveAmount != null) {
          response.setReceiveAmount(Number(quote.receiveAmount));
        }
        if (quote.route) {
          response.setSourceAmount(Number(quote.route.sourceAmount));
          response.setSenderAssetCode(quote.route.senderAssetCode);
        }
      } else if (quote.state === 'FAILED') {
        response.setErrorName(quote.errorName);
        response.setMessage(quote.message);
      }

      callback(null, response);
    } catch (err) {
      callback({ code: grpc.status.INTERNAL, message: (err as Error).message });
    }
  }

  private async _handleGetPayment(
    call: ServerUnaryCall<GetPaymentRequest, GetPaymentResponse>,
    callback: sendUnaryData<GetPaymentResponse>
  ): Promise<void> {
    const paymentIntentId = call.request.getPaymentIntentId();
    const paymentId = call.request.getId();

    try {
      const [paymentIntent] = await this._repo.fetchByIdsWithPayments([
        paymentIntentId
      ]);
      if (!paymentIntent) {
        callback({
          code: grpc.status.NOT_FOUND,
          message: `Payment intent '${paymentIntentId}' not found`
        });
        return;
      }

      const payment = paymentIntent.sentPayments.find(
        (p) => p.id === paymentId
      );
      if (!payment) {
        callback({
          code: grpc.status.NOT_FOUND,
          message: `Payment '${paymentId}' not found`
        });
        return;
      }

      const response = new GetPaymentResponse();
      response.setPayment(this._toPbPayment(payment, paymentIntent));

      callback(null, response);
    } catch (err) {
      callback({ code: grpc.status.INTERNAL, message: (err as Error).message });
    }
  }

  private async _handleGetPaymentIntentsPage(
    call: ServerUnaryCall<
      GetPaymentIntentsPageRequest,
      GetPaymentIntentsPageResponse
    >,
    callback: sendUnaryData<GetPaymentIntentsPageResponse>
  ): Promise<void> {
    try {
      const request = call.request;
      const cursorContext: CursorContext = {
        sortOrder: this._pageSortOrder(request.getSortOrder()),
        walletAddressId: request.getWalletAddressId() || undefined
      };
      const cursor = request.getCursor() || undefined;

      const page = await this._repo.fetchPaymentIntentsPage({
        walletAddressId: cursorContext.walletAddressId,
        cursor: cursor && decodeCursor(cursor, cursorContext),
        limit: this._clampPageLimit(request.getLimit()),
        backwards: request.getBackwards(),
        sortOrder: cursorContext.sortOrder
      });

      const response = new GetPaymentIntentsPageResponse();
      response.setPaymentIntentsList(
        page.items.map((intent) => this._toPbPaymentIntent(intent))
      );
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

  private async _handleGetPaymentsPage(
    call: ServerUnaryCall<GetPaymentsPageRequest, GetPaymentsPageResponse>,
    callback: sendUnaryData<GetPaymentsPageResponse>
  ): Promise<void> {
    try {
      const request = call.request;
      const cursorContext: CursorContext = {
        sortOrder: this._pageSortOrder(request.getSortOrder()),
        walletAddressId: request.getWalletAddressId() || undefined,
        paymentIntentId: request.getPaymentIntentId() || undefined
      };
      const cursor = request.getCursor() || undefined;

      const page = await this._repo.fetchSentPaymentsPage({
        walletAddressId: cursorContext.walletAddressId,
        paymentIntentId: cursorContext.paymentIntentId,
        cursor: cursor && decodeCursor(cursor, cursorContext),
        limit: this._clampPageLimit(request.getLimit()),
        backwards: request.getBackwards(),
        sortOrder: cursorContext.sortOrder
      });

      // Hydrate parent intents in one batched fetch — receiveAmount is
      // denominated in the parent intent's (receive-side) asset, and the
      // OP receiver URL comes from the parent's remoteUrl.
      const intentIds = [...new Set(page.items.map((p) => p.paymentIntentId))];
      const parentIntents = await this._repo.fetchByIds(intentIds);
      const intentById = new Map(parentIntents.map((i) => [i.id, i]));

      const response = new GetPaymentsPageResponse();
      response.setPaymentsList(
        page.items.map((payment) => {
          const parent = intentById.get(payment.paymentIntentId);
          if (!parent) {
            throw new Error(
              `Parent payment intent '${payment.paymentIntentId}' not found for payment '${payment.id}'`
            );
          }
          return this._toPbPayment(payment, parent);
        })
      );
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
    if (!limit) return PaymentsServiceServer.DEFAULT_PAGE_LIMIT;
    return Math.min(limit, PaymentsServiceServer.MAX_PAGE_LIMIT);
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

  private _toPbPaymentIntent(
    paymentIntent: Omit<IPaymentIntent, 'sentPayments' | 'inboundPayments'>
  ): PaymentIntent {
    const pbPaymentIntent = new PaymentIntent();
    pbPaymentIntent.setId(paymentIntent.id);
    pbPaymentIntent.setReceiverWalletAddress(
      paymentIntent.receiverWalletAddress
    );
    pbPaymentIntent.setState(paymentIntent.state);
    pbPaymentIntent.setDestination(paymentIntent.destination);
    pbPaymentIntent.setReceivedAmount(Number(paymentIntent.receivedAmount));
    pbPaymentIntent.setAssetCode(paymentIntent.assetCode);
    pbPaymentIntent.setAssetScale(paymentIntent.assetScale);
    pbPaymentIntent.setCreatedAt(
      new Date(paymentIntent.createdAt).toISOString()
    );
    if (paymentIntent.incomingAmount != null) {
      pbPaymentIntent.setIncomingAmount(Number(paymentIntent.incomingAmount));
    }
    if (paymentIntent.expiresAt) {
      pbPaymentIntent.setExpiresAt(
        new Date(paymentIntent.expiresAt).toISOString()
      );
    }
    if (paymentIntent.destinationIlpAddress) {
      pbPaymentIntent.setDestinationIlpAddress(
        paymentIntent.destinationIlpAddress
      );
    }
    if (paymentIntent.remoteUrl) {
      pbPaymentIntent.setRemoteUrl(paymentIntent.remoteUrl);
    }
    if (paymentIntent.metadata) {
      pbPaymentIntent.setMetadata(JSON.stringify(paymentIntent.metadata));
    }
    return pbPaymentIntent;
  }

  /**
   * Projects a payment onto the wire. Takes the stored shape, which both
   * domain variants satisfy, because this mapping needs fields rather than
   * the local/remote distinction.
   */
  private _toPbPayment(
    payment: IStoredSentPayment,
    parentIntent: { assetCode: string; assetScale: number; remoteUrl?: string }
  ): Payment {
    const pbPayment = new Payment();
    pbPayment.setId(payment.id);
    pbPayment.setState(payment.state);
    pbPayment.setSenderWalletAddress(payment.senderWalletAddress);
    pbPayment.setSenderWalletAddressId(payment.senderWalletAddressId);
    pbPayment.setPaymentIntentId(payment.paymentIntentId);
    pbPayment.setCreatedAt(new Date(payment.createdAt).toISOString());
    if (payment.quoteId) {
      pbPayment.setQuoteId(payment.quoteId);
    }
    if (payment.failReason) {
      pbPayment.setFailReason(payment.failReason);
    }
    if (parentIntent.remoteUrl) {
      pbPayment.setRemotePaymentIntentUrl(parentIntent.remoteUrl);
    }
    if (payment.metadata) {
      pbPayment.setMetadata(JSON.stringify(payment.metadata));
    }

    // debitAmount and sentAmount are denominated in the payment's own
    // (sender-side) asset pair.
    const debitAmount = new Amount();
    debitAmount.setValue(Number(payment.debitAmount));
    debitAmount.setAssetCode(payment.assetCode);
    debitAmount.setAssetScale(payment.assetScale);
    pbPayment.setDebitAmount(debitAmount);

    const sentAmount = new Amount();
    sentAmount.setValue(Number(payment.sentAmount));
    sentAmount.setAssetCode(payment.assetCode);
    sentAmount.setAssetScale(payment.assetScale);
    pbPayment.setSentAmount(sentAmount);

    // receiveAmount is denominated in the parent intent's (receive-side)
    // asset — a different currency for cross-currency payments. A payment
    // created without a quote fixes only the debit side, so it has none; the
    // field is left unset rather than zeroed, and reads as absent on the wire.
    if (payment.receiveAmount !== null) {
      const receiveAmount = new Amount();
      receiveAmount.setValue(Number(payment.receiveAmount));
      receiveAmount.setAssetCode(parentIntent.assetCode);
      receiveAmount.setAssetScale(parentIntent.assetScale);
      pbPayment.setReceiveAmount(receiveAmount);
    }

    return pbPayment;
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
      const response = new CreatePaymentIntentResponse();
      response.setId(evt.payload.id);
      response.setReceiverWalletAddress(evt.payload.receiverWalletAddress);
      response.setState(evt.payload.state);
      response.setDestination(evt.payload.destination);
      response.setReceivedAmount(Number(evt.payload.receivedAmount));
      response.setAssetCode(evt.payload.assetCode);
      response.setAssetScale(evt.payload.assetScale);
      response.setCreatedAt(new Date(evt.payload.createdAt).toISOString());
      if (evt.payload.incomingAmount != null) {
        response.setIncomingAmount(Number(evt.payload.incomingAmount));
      }
      if (evt.payload.expiresAt) {
        response.setExpiresAt(new Date(evt.payload.expiresAt).toISOString());
      }
      this._resolvePendingResponse(pending, requestId, null, response);
    } else if (PaymentIntentDomainEvent.isPaymentIntentCreateFailedEvent(evt)) {
      this._resolvePendingResponse(
        pending,
        requestId,
        this._toServiceError(evt.payload)
      );
    } else if (PaymentIntentDomainEvent.isPaymentIntentCompletedEvent(evt)) {
      const response = new CompletePaymentIntentResponse();
      response.setId(evt.payload.id);
      response.setReceiverWalletAddress(evt.payload.receiverWalletAddress);
      response.setState(evt.payload.state);
      response.setDestination(evt.payload.destination);
      response.setReceivedAmount(Number(evt.payload.receivedAmount));
      response.setAssetCode(evt.payload.assetCode);
      response.setAssetScale(evt.payload.assetScale);
      response.setCreatedAt(new Date(evt.payload.createdAt).toISOString());
      if (evt.payload.incomingAmount != null) {
        response.setIncomingAmount(Number(evt.payload.incomingAmount));
      }
      if (evt.payload.expiresAt) {
        response.setExpiresAt(new Date(evt.payload.expiresAt).toISOString());
      }
      this._resolvePendingResponse(pending, requestId, null, response);
    } else if (
      PaymentIntentDomainEvent.isPaymentIntentCompleteFailedEvent(evt)
    ) {
      this._resolvePendingResponse(
        pending,
        requestId,
        this._toServiceError(evt.payload)
      );
    } else if (PaymentIntentDomainEvent.isQuoteCompletedEvent(evt)) {
      const response = new CreateQuoteResponse()
        .setId(evt.payload.id)
        .setPaymentIntentId(evt.payload.paymentIntentId)
        .setSenderWalletAddress(evt.payload.senderWalletAddress)
        .setSenderWalletAddressId(evt.payload.senderWalletAddressId)
        .setExpiresAt(evt.payload.expiresAt)
        .setCreatedAt(evt.payload.createdAt)
        .setDebitAmount(Number(evt.payload.debitAmount))
        .setReceiveAmount(Number(evt.payload.receiveAmount))
        .setExchangeRate(evt.payload.exchangeRate);
      this._resolvePendingResponse(pending, requestId, null, response);
    } else if (PaymentIntentDomainEvent.isQuoteCreateFailedEvent(evt)) {
      this._resolvePendingResponse(
        pending,
        requestId,
        this._toServiceError(evt.payload)
      );
    } else if (PaymentIntentDomainEvent.isPaymentCreatedEvent(evt)) {
      const p = evt.payload;
      const response = new CreatePaymentResponse().setPayment(
        this._toPbPayment(
          {
            id: p.id,
            state: p.state,
            senderWalletAddress: p.senderWalletAddress,
            senderWalletAddressId: p.senderWalletAddressId,
            paymentIntentId: p.paymentIntentId,
            quoteId: p.quoteId,
            assetCode: p.assetCode,
            assetScale: p.assetScale,
            createdAt: p.createdAt,
            debitAmount: BigInt(p.debitAmount ?? 0),
            receiveAmount:
              p.receiveAmount === null ? null : BigInt(p.receiveAmount),
            sentAmount: BigInt(p.sentAmount ?? 0),
            metadata: p.metadata
          },
          {
            // receiveAmount is denominated in the parent intent's asset
            assetCode: p.receiveAssetCode,
            assetScale: p.receiveAssetScale,
            remoteUrl: p.paymentIntentRemoteUrl
          }
        )
      );
      this._resolvePendingResponse(pending, requestId, null, response);
    } else if (PaymentIntentDomainEvent.isPaymentCreateFailedEvent(evt)) {
      this._resolvePendingResponse(
        pending,
        requestId,
        this._toServiceError(evt.payload)
      );
    } else if (PaymentIntentDomainEvent.isRemotePaymentSendApprovedEvent(evt)) {
      const response = new ApprovePaymentResponse()
        .setId(evt.payload.paymentId)
        .setState(evt.payload.state);
      this._resolvePendingResponse(pending, requestId, null, response);
    } else if (PaymentIntentDomainEvent.isPaymentFailedEvent(evt)) {
      const response = new ApprovePaymentResponse()
        .setId(evt.payload.id)
        .setState(evt.payload.state);
      this._resolvePendingResponse(pending, requestId, null, response);
    } else if (PaymentIntentDomainEvent.isPaymentCompletedEvent(evt)) {
      const response = new ApprovePaymentResponse()
        .setId(evt.payload.id)
        .setState(evt.payload.state);
      this._resolvePendingResponse(pending, requestId, null, response);
    } else if (PaymentIntentDomainEvent.isPaymentCompleteFailedEvent(evt)) {
      this._resolvePendingResponse(
        pending,
        requestId,
        this._toServiceError(evt.payload)
      );
    } else if (PaymentIntentDomainEvent.isPaymentCancelledEvent(evt)) {
      const response = new CancelPaymentResponse().setId(evt.payload.id);
      this._resolvePendingResponse(pending, requestId, null, response);
    } else if (PaymentIntentDomainEvent.isPaymentCancelFailedEvent(evt)) {
      this._resolvePendingResponse(
        pending,
        requestId,
        this._toServiceError(evt.payload)
      );
    } else {
      this._logger.warn(
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
