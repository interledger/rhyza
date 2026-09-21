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
  CancelPaymentRequest as PbCancelPaymentRequest,
  CancelPaymentResponse as PbCancelPaymentResponse
} from 'payments-public-types-lib';
import {
  ApprovePaymentResult,
  CancelPaymentResult,
  CompletePaymentIntentResult,
  CreatePaymentIntentResult,
  CreatePaymentResult,
  CreateQuoteResult,
  GetPaymentIntentResult,
  GetPaymentResult,
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
    metadata?: string
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
      request.setMetadata(metadata);
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

          return resolve({
            id: response.getId()
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

          return resolve({
            id: response.getId(),
            state: response.getState()
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
    debitAmount?: number
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

          const incomingAmount = response.getIncomingAmount();
          const expiresAt = response.getExpiresAt();
          const destinationIlpAddress = response.getDestinationIlpAddress();

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
            destinationIlpAddress: destinationIlpAddress || undefined
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

          const quoteId = response.getQuoteId();

          return resolve({
            id: response.getId(),
            state: response.getState(),
            senderWalletAddress: response.getSenderWalletAddress(),
            senderWalletAddressId: response.getSenderWalletAddressId(),
            paymentIntentId: response.getPaymentIntentId(),
            assetCode: response.getAssetCode(),
            assetScale: response.getAssetScale(),
            quoteId: quoteId || undefined,
            debitAmount: BigInt(response.getDebitAmount()),
            receiveAmount: BigInt(response.getReceiveAmount()),
            sentAmount: BigInt(response.getSentAmount())
          });
        }
      );
    });
  }
}
