import * as grpc from '@grpc/grpc-js';
import { ServiceError, status } from '@grpc/grpc-js';
import { randomUUID } from 'node:crypto';
import { createServiceError } from './errors';
import {
  CreatePaymentIntentRequest as PbCreatePaymentIntentRequest,
  CreatePaymentIntentResponse as PbCreatePaymentIntentResponse,
  CompletePaymentIntentRequest as PbCompletePaymentIntentRequest,
  CompletePaymentIntentResponse as PbCompletePaymentIntentResponse,
  PaymentsGrpcClient,
  GetQuoteRequest as PbGetQuoteRequest,
  GetQuoteResponse as PbGetQuoteResponse,
  CreateQuoteRequest as PbCreateQuoteRequest,
  CreateQuoteResponse as PbCreateQuoteResponse,
  CreatePaymentRequest as PbCreatePaymentRequest,
  CreatePaymentResponse as PbCreatePaymentResponse,
  ApprovePaymentRequest as PbApprovePaymentRequest,
  ApprovePaymentResponse as PbApprovePaymentResponse,
  GetPaymentIntentRequest as PbGetPaymentIntentRequest,
  GetPaymentIntentResponse as PbGetPaymentIntentResponse,
  GetPaymentRequest as PbGetPaymentRequest,
  GetPaymentResponse as PbGetPaymentResponse,
  GetPaymentIntentsPageRequest as PbGetPaymentIntentsPageRequest,
  GetPaymentsPageRequest as PbGetPaymentsPageRequest,
  Amount as PbAmount,
  PaymentIntent as PbPaymentIntent,
  Payment as PbPayment,
  CancelPaymentRequest as PbCancelPaymentRequest,
  CancelPaymentResponse as PbCancelPaymentResponse,
  SortOrder as PbSortOrder
} from 'payments-public-types-lib';
import {
  ApprovePaymentResult,
  CancelPaymentResult,
  CreatePaymentIntentResult,
  CompletePaymentIntentResult,
  CreatePaymentResult,
  CreateQuoteResult,
  GetPaymentIntentResult,
  GetPaymentResult,
  GetQuoteResult,
  IAmount,
  IPage,
  IPageQuery,
  IncomingPaymentInput
} from './local-types';

export class PaymentsClient {
  private readonly _serverUrl: string;
  private readonly _grpcConnectTimeOutMs: number;
  private readonly _grpcClient: PaymentsGrpcClient;
  private readonly _openPaymentsUrl: string | undefined;

  /**
   * @param openPaymentsUrl - Base URL of this node's Open Payments server (e.g. https://payments.example.com).
   *   Required for remote quoting and payments; may omit for local-only use.
   */
  constructor(
    serverUrl: string,
    grpcConnectTimeOutMs: number = 5_000,
    openPaymentsUrl?: string
  ) {
    this._serverUrl = serverUrl;
    this._grpcConnectTimeOutMs = grpcConnectTimeOutMs;
    this._openPaymentsUrl = openPaymentsUrl;

    this._grpcClient = new PaymentsGrpcClient(
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

  async createPaymentIntent(
    id: string,
    receiverWalletAddressId: string,
    receiverWalletAddress: string,
    incomingAmount?: number,
    expiresAt?: string,
    metadata?: Record<string, unknown>
  ): Promise<CreatePaymentIntentResult> {
    const request = new PbCreatePaymentIntentRequest();
    request.setId(id);
    request.setWalletAddressId(receiverWalletAddressId);
    request.setWalletAddress(receiverWalletAddress);

    if (incomingAmount !== undefined) {
      request.setIncomingAmount(incomingAmount);
    }
    if (expiresAt !== undefined) {
      request.setExpiresAt(expiresAt);
    }
    if (metadata !== undefined) {
      request.setMetadata(JSON.stringify(metadata));
    }

    return new Promise((resolve, reject) => {
      this._grpcClient.createPaymentIntent(
        request,
        (
          error: ServiceError | null,
          response: PbCreatePaymentIntentResponse
        ) => {
          if (error) {
            console.error(error);
            return reject(error);
          }

          const incomingAmount = response.getIncomingAmount();
          const expiresAt = response.getExpiresAt();

          return resolve({
            id: response.getId(),
            receiverWalletAddress: response.getReceiverWalletAddress(),
            state: response.getState(),
            destination: response.getDestination(),
            receivedAmount: BigInt(response.getReceivedAmount()),
            assetCode: response.getAssetCode(),
            assetScale: response.getAssetScale(),
            incomingAmount: incomingAmount ? BigInt(incomingAmount) : undefined,
            expiresAt: expiresAt || undefined,
            createdAt: response.getCreatedAt()
          });
        }
      );
    });
  }

  async completePaymentIntent(
    id: string
  ): Promise<CompletePaymentIntentResult> {
    const request = new PbCompletePaymentIntentRequest();
    request.setId(id);

    return new Promise((resolve, reject) => {
      this._grpcClient.completePaymentIntent(
        request,
        (
          error: ServiceError | null,
          response: PbCompletePaymentIntentResponse
        ) => {
          if (error) {
            console.error(error);
            return reject(error);
          }

          const incomingAmount = response.getIncomingAmount();
          const expiresAt = response.getExpiresAt();

          return resolve({
            id: response.getId(),
            receiverWalletAddress: response.getReceiverWalletAddress(),
            state: response.getState(),
            destination: response.getDestination(),
            receivedAmount: BigInt(response.getReceivedAmount()),
            assetCode: response.getAssetCode(),
            assetScale: response.getAssetScale(),
            incomingAmount: incomingAmount ? BigInt(incomingAmount) : undefined,
            expiresAt: expiresAt || undefined,
            createdAt: response.getCreatedAt()
          });
        }
      );
    });
  }

  async createQuote(
    id: string,
    incomingPayment: IncomingPaymentInput,
    senderWalletAddressId: string,
    senderWalletAddress: string,
    debitAmount?: number,
    receiveAmount?: number
  ): Promise<CreateQuoteResult> {
    let paymentIntentId: string;
    let remoteUrl: string | undefined;

    if ('incomingPaymentUrl' in incomingPayment) {
      if (!this._openPaymentsUrl) {
        throw createServiceError(
          status.FAILED_PRECONDITION,
          'Remote quoting is currently not configured',
          'RemoteQuotingNotConfigured'
        );
      }
      if (
        incomingPayment.incomingPaymentUrl.startsWith(this._openPaymentsUrl)
      ) {
        paymentIntentId = incomingPayment.incomingPaymentUrl.split('/').at(-1)!;
      } else {
        paymentIntentId = randomUUID();
        remoteUrl = incomingPayment.incomingPaymentUrl;
      }
    } else {
      paymentIntentId = incomingPayment.incomingPaymentId;
    }

    const request = new PbCreateQuoteRequest();
    request.setId(id);
    request.setWalletAddressId(senderWalletAddressId);
    request.setWalletAddress(senderWalletAddress);
    request.setPaymentIntentId(paymentIntentId);

    if (debitAmount) {
      request.setDebitAmount(debitAmount);
    }
    if (receiveAmount) {
      request.setReceiveAmount(receiveAmount);
    }
    if (remoteUrl) {
      request.setRemoteUrl(remoteUrl);
    }

    return new Promise((resolve, reject) => {
      this._grpcClient.createQuote(
        request,
        (error: ServiceError | null, response: PbCreateQuoteResponse) => {
          if (error) {
            console.error(error);
            return reject(error);
          }

          return resolve({
            id: response.getId(),
            paymentIntentId: response.getPaymentIntentId(),
            senderWalletAddress: response.getSenderWalletAddress(),
            senderWalletAddressId: response.getSenderWalletAddressId(),
            expiresAt: response.getExpiresAt(),
            createdAt: response.getCreatedAt(),
            debitAmount: BigInt(response.getDebitAmount()),
            receiveAmount: BigInt(response.getReceiveAmount()),
            exchangeRate: response.getExchangeRate()
          });
        }
      );
    });
  }

  async createPayment(
    id: string,
    walletAddressId: string,
    walletAddress: string,
    paymentIntentId: string,
    quoteId?: string,
    debitAmount?: number,
    grantId?: string,
    metadata?: Record<string, unknown>
  ): Promise<CreatePaymentResult> {
    const request = new PbCreatePaymentRequest();
    request.setId(id);
    request.setWalletAddressId(walletAddressId);
    request.setWalletAddress(walletAddress);
    request.setPaymentIntentId(paymentIntentId);

    if (quoteId) {
      request.setQuoteId(quoteId);
    }

    if (debitAmount) {
      request.setDebitAmount(debitAmount);
    }

    if (grantId) {
      request.setGrantId(grantId);
    }

    if (metadata) {
      request.setMetadata(JSON.stringify(metadata));
    }

    return new Promise((resolve, reject) => {
      this._grpcClient.createPayment(
        request,
        (error: ServiceError | null, response: PbCreatePaymentResponse) => {
          if (error) {
            console.error(error);
            return reject(error);
          }

          return resolve({
            id: response.getId()
          });
        }
      );
    });
  }

  async approvePayment(
    paymentIntentId: string,
    id: string
  ): Promise<ApprovePaymentResult> {
    const request = new PbApprovePaymentRequest();
    request.setId(id);
    request.setPaymentIntentId(paymentIntentId);

    return new Promise((resolve, reject) => {
      this._grpcClient.approvePayment(
        request,
        (error: ServiceError | null, response: PbApprovePaymentResponse) => {
          if (error) {
            console.error(error);
            return reject(error);
          }

          return resolve({
            id: response.getId(),
            state: response.getState() || undefined
          });
        }
      );
    });
  }

  async cancelPayment(
    paymentIntentId: string,
    id: string,
    reason?: string
  ): Promise<CancelPaymentResult> {
    const request = new PbCancelPaymentRequest();
    request.setId(id);
    request.setPaymentIntentId(paymentIntentId);
    if (reason) {
      request.setReason(reason);
    }

    return new Promise((resolve, reject) => {
      this._grpcClient.cancelPayment(
        request,
        (error: ServiceError | null, response: PbCancelPaymentResponse) => {
          if (error) {
            console.error(error);
            return reject(error);
          }

          return resolve({
            id: response.getId()
          });
        }
      );
    });
  }

  async getPaymentIntent(id: string): Promise<GetPaymentIntentResult> {
    const request = new PbGetPaymentIntentRequest();
    request.setId(id);

    return new Promise((resolve, reject) => {
      this._grpcClient.getPaymentIntent(
        request,
        (error: ServiceError | null, response: PbGetPaymentIntentResponse) => {
          if (error) {
            console.error(error);
            return reject(error);
          }

          const paymentIntent = response.getPaymentIntent();
          if (!paymentIntent) {
            return reject(
              createServiceError(
                status.INTERNAL,
                'Response missing payment intent'
              )
            );
          }

          return resolve(PaymentsClient._paymentIntentFromPb(paymentIntent));
        }
      );
    });
  }

  async getQuote(paymentIntentId: string, id: string): Promise<GetQuoteResult> {
    const request = new PbGetQuoteRequest();
    request.setPaymentIntentId(paymentIntentId);
    request.setId(id);

    return new Promise((resolve, reject) => {
      this._grpcClient.getQuote(
        request,
        (error: ServiceError | null, response: PbGetQuoteResponse) => {
          if (error) {
            console.error(error);
            return reject(error);
          }

          return resolve({
            id: response.getId(),
            paymentIntentId: response.getPaymentIntentId(),
            state: response.getState(),
            senderWalletAddress: response.getSenderWalletAddress(),
            senderWalletAddressId: response.getSenderWalletAddressId(),
            createdAt: response.getCreatedAt(),
            expiresAt: response.hasExpiresAt()
              ? response.getExpiresAt()
              : undefined,
            debitAmount: response.hasDebitAmount()
              ? BigInt(response.getDebitAmount()!)
              : undefined,
            receiveAmount: response.hasReceiveAmount()
              ? BigInt(response.getReceiveAmount()!)
              : undefined,
            exchangeRate: response.hasExchangeRate()
              ? response.getExchangeRate()
              : undefined,
            sourceAmount: response.hasSourceAmount()
              ? BigInt(response.getSourceAmount()!)
              : undefined,
            senderAssetCode: response.hasSenderAssetCode()
              ? response.getSenderAssetCode()
              : undefined,
            errorName: response.hasErrorName()
              ? response.getErrorName()
              : undefined,
            message: response.hasMessage() ? response.getMessage() : undefined
          });
        }
      );
    });
  }

  async getPayment(
    paymentIntentId: string,
    id: string
  ): Promise<GetPaymentResult> {
    const request = new PbGetPaymentRequest();
    request.setId(id);
    request.setPaymentIntentId(paymentIntentId);

    return new Promise((resolve, reject) => {
      this._grpcClient.getPayment(
        request,
        (error: ServiceError | null, response: PbGetPaymentResponse) => {
          if (error) {
            console.error(error);
            return reject(error);
          }

          const payment = response.getPayment();
          if (!payment) {
            return reject(
              createServiceError(status.INTERNAL, 'Response missing payment')
            );
          }

          return resolve(PaymentsClient._paymentFromPb(payment));
        }
      );
    });
  }

  async getPaymentIntentsPage(
    query: IPageQuery = {}
  ): Promise<IPage<GetPaymentIntentResult>> {
    const { cursor, limit, backwards, sortOrder } =
      PaymentsClient._pageArgs(query);

    const request = new PbGetPaymentIntentsPageRequest();
    if (query.walletAddressId) {
      request.setWalletAddressId(query.walletAddressId);
    }
    if (cursor) request.setCursor(cursor);
    request.setLimit(limit);
    request.setBackwards(backwards);
    request.setSortOrder(sortOrder);

    return new Promise((resolve, reject) => {
      this._grpcClient.getPaymentIntentsPage(request, (error, response) => {
        if (error) {
          console.error(error);
          return reject(error);
        }

        return resolve({
          items: response
            .getPaymentIntentsList()
            .map((pb) => PaymentsClient._paymentIntentFromPb(pb)),
          pagination: {
            startCursor: response.getStartCursor() || undefined,
            endCursor: response.getEndCursor() || undefined,
            hasNextPage: response.getHasNextPage(),
            hasPreviousPage: response.getHasPreviousPage()
          }
        });
      });
    });
  }

  async getPaymentsPage(
    query: IPageQuery & { paymentIntentId?: string } = {}
  ): Promise<IPage<GetPaymentResult>> {
    const { cursor, limit, backwards, sortOrder } =
      PaymentsClient._pageArgs(query);

    const request = new PbGetPaymentsPageRequest();
    if (query.walletAddressId) {
      request.setWalletAddressId(query.walletAddressId);
    }
    if (query.paymentIntentId) {
      request.setPaymentIntentId(query.paymentIntentId);
    }
    if (cursor) request.setCursor(cursor);
    request.setLimit(limit);
    request.setBackwards(backwards);
    request.setSortOrder(sortOrder);

    return new Promise((resolve, reject) => {
      this._grpcClient.getPaymentsPage(request, (error, response) => {
        if (error) {
          console.error(error);
          return reject(error);
        }

        return resolve({
          items: response
            .getPaymentsList()
            .map((pb) => PaymentsClient._paymentFromPb(pb)),
          pagination: {
            startCursor: response.getStartCursor() || undefined,
            endCursor: response.getEndCursor() || undefined,
            hasNextPage: response.getHasNextPage(),
            hasPreviousPage: response.getHasPreviousPage()
          }
        });
      });
    });
  }

  // Maps first/last query params (Open Payments style) onto the gRPC
  // limit/backwards request shape, enforcing the shared validation rules.
  private static _pageArgs(query: IPageQuery): {
    cursor?: string;
    limit: number;
    backwards: boolean;
    sortOrder: PbSortOrder;
  } {
    const { cursor, first, last, sortOrder } = query;

    if (sortOrder != null && sortOrder !== 'asc' && sortOrder !== 'desc') {
      throw createServiceError(
        status.INVALID_ARGUMENT,
        "'sortOrder' must be 'asc' or 'desc'"
      );
    }

    if (first != null && last != null) {
      throw createServiceError(
        status.INVALID_ARGUMENT,
        "Cannot provide both 'first' and 'last'"
      );
    }
    if (last != null && cursor == null) {
      throw createServiceError(
        status.INVALID_ARGUMENT,
        "'last' requires 'cursor'"
      );
    }
    for (const [name, value] of [
      ['first', first],
      ['last', last]
    ] as const) {
      if (value != null && (!Number.isInteger(value) || value < 1)) {
        throw createServiceError(
          status.INVALID_ARGUMENT,
          `'${name}' must be a positive integer`
        );
      }
    }

    return {
      cursor,
      limit: last ?? first ?? 0, // 0 => server default
      backwards: last != null,
      // Unset => UNSPECIFIED, letting the server apply its default order.
      sortOrder:
        sortOrder === 'asc'
          ? PbSortOrder.SORT_ORDER_ASC
          : sortOrder === 'desc'
            ? PbSortOrder.SORT_ORDER_DESC
            : PbSortOrder.SORT_ORDER_UNSPECIFIED
    };
  }

  private static _paymentIntentFromPb(
    response: PbPaymentIntent
  ): GetPaymentIntentResult {
    const incomingAmount = response.getIncomingAmount();
    const expiresAt = response.getExpiresAt();
    const destinationIlpAddress = response.getDestinationIlpAddress();

    return {
      id: response.getId(),
      receiverWalletAddress: response.getReceiverWalletAddress(),
      state: response.getState(),
      destination: response.getDestination(),
      receivedAmount: BigInt(response.getReceivedAmount()),
      assetCode: response.getAssetCode(),
      assetScale: response.getAssetScale(),
      incomingAmount: incomingAmount ? BigInt(incomingAmount) : undefined,
      expiresAt: expiresAt || undefined,
      destinationIlpAddress: destinationIlpAddress || undefined,
      createdAt: response.getCreatedAt(),
      remoteUrl: response.getRemoteUrl() || undefined,
      metadata: PaymentsClient._metadataFromPb(response.getMetadata())
    };
  }

  private static _paymentFromPb(response: PbPayment): GetPaymentResult {
    const quoteId = response.getQuoteId();
    const remoteUrl = response.getRemoteUrl();
    const failReason = response.getFailReason();

    return {
      id: response.getId(),
      state: response.getState(),
      senderWalletAddress: response.getSenderWalletAddress(),
      senderWalletAddressId: response.getSenderWalletAddressId(),
      paymentIntentId: response.getPaymentIntentId(),
      quoteId: quoteId || undefined,
      debitAmount: PaymentsClient._amountFromPb(
        response.getDebitAmount(),
        'debitAmount'
      ),
      receiveAmount: PaymentsClient._amountFromPb(
        response.getReceiveAmount(),
        'receiveAmount'
      ),
      sentAmount: PaymentsClient._amountFromPb(
        response.getSentAmount(),
        'sentAmount'
      ),
      createdAt: response.getCreatedAt(),
      remoteUrl: remoteUrl || undefined,
      failReason: failReason || undefined,
      metadata: PaymentsClient._metadataFromPb(response.getMetadata())
    };
  }

  private static _metadataFromPb(
    metadata?: string
  ): Record<string, unknown> | undefined {
    if (!metadata) return undefined;
    const parsed = JSON.parse(metadata);
    if (Object.keys(parsed).length === 0) return undefined;
    return parsed as Record<string, unknown>;
  }

  private static _amountFromPb(
    pbAmount: PbAmount | undefined,
    field: string
  ): IAmount {
    if (!pbAmount) {
      throw createServiceError(
        status.INTERNAL,
        `Missing '${field}' on payment response`
      );
    }
    return {
      value: BigInt(pbAmount.getValue()),
      assetCode: pbAmount.getAssetCode(),
      assetScale: pbAmount.getAssetScale()
    };
  }
}
