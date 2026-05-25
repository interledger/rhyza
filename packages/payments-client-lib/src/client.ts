import * as grpc from '@grpc/grpc-js';
import { ServiceError, status } from '@grpc/grpc-js';
import { randomUUID } from 'node:crypto';
import {
  PaymentIntentNotFoundError,
  RemoteQuotingNotConfiguredError
} from './errors';
import {
  ICreateIncomingPaymentResponse,
  ICreateQuoteResponse,
  ICreateOutgoingPaymentResponse,
  IApproveOutgoingPaymentResponse,
  IGetPaymentIntentResponse
} from './local-types';
import {
  CreateIncomingPaymentRequest,
  CreateIncomingPaymentResponse,
  PaymentsGrpcClient,
  CreateQuoteRequest,
  CreateQuoteResponse,
  CreateOutgoingPaymentRequest,
  CreateOutgoingPaymentResponse,
  ApproveOutgoingPaymentRequest,
  ApproveOutgoingPaymentResponse,
  GetPaymentIntentRequest,
  GetPaymentIntentResponse
} from 'payments-public-types-lib';

type IncomingPaymentInput =
  | { incomingPaymentId: string }
  | { incomingPaymentUrl: string };

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

  async createIncomingPayment(
    id: string,
    receiverWalletAddressId: string,
    receiverWalletAddress: string,
    incomingAmount?: number,
    expiresAt?: string,
    metadata?: string
  ): Promise<ICreateIncomingPaymentResponse> {
    const request = new CreateIncomingPaymentRequest();
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
      this._grpcClient.createIncomingPayment(
        request,
        (
          error: ServiceError | null,
          response: CreateIncomingPaymentResponse
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

  async createQuote(
    id: string,
    incomingPayment: IncomingPaymentInput,
    senderWalletAddressId: string,
    senderWalletAddress: string,
    debitAmount?: number,
    receiveAmount?: number
  ): Promise<ICreateQuoteResponse> {
    let paymentIntentId: string;
    let remoteUrl: string | undefined;

    if ('incomingPaymentUrl' in incomingPayment) {
      if (!this._openPaymentsUrl) {
        throw new RemoteQuotingNotConfiguredError();
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

    const request = new CreateQuoteRequest();
    request.setId(id);
    request.setWalletAddressId(senderWalletAddressId);
    request.setWalletAddress(senderWalletAddress);
    request.setIncomingPaymentId(paymentIntentId);

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
        (error: ServiceError | null, response: CreateQuoteResponse) => {
          if (error) {
            console.error(error);
            return reject(error);
          }

          return resolve({
            id: response.getId(),
            paymentIntentId: response.getPaymentIntentId()
          });
        }
      );
    });
  }

  async createOutgoingPayment(
    id: string,
    walletAddressId: string,
    walletAddress: string,
    incomingPaymentId: string,
    quoteId?: string,
    debitAmount?: number
  ): Promise<ICreateOutgoingPaymentResponse> {
    const request = new CreateOutgoingPaymentRequest();
    request.setId(id);
    request.setWalletAddressId(walletAddressId);
    request.setWalletAddress(walletAddress);
    request.setIncomingPaymentId(incomingPaymentId);

    if (quoteId) {
      request.setQuoteId(quoteId);
    }

    if (debitAmount) {
      request.setDebitAmount(debitAmount);
    }

    return new Promise((resolve, reject) => {
      this._grpcClient.createOutgoingPayment(
        request,
        (
          error: ServiceError | null,
          response: CreateOutgoingPaymentResponse
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

  async approveOutgoingPayment(
    id: string,
    incomingPaymentId: string
  ): Promise<IApproveOutgoingPaymentResponse> {
    const request = new ApproveOutgoingPaymentRequest();
    request.setId(id);
    request.setIncomingPaymentId(incomingPaymentId);

    return new Promise((resolve, reject) => {
      this._grpcClient.approveOutgoingPayment(
        request,
        (
          error: ServiceError | null,
          response: ApproveOutgoingPaymentResponse
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

  async getPaymentIntent(id: string): Promise<IGetPaymentIntentResponse> {
    const request = new GetPaymentIntentRequest();
    request.setId(id);

    return new Promise((resolve, reject) => {
      this._grpcClient.getPaymentIntent(
        request,
        (error: ServiceError | null, response: GetPaymentIntentResponse) => {
          if (error) {
            if (error.code === status.NOT_FOUND) {
              return reject(new PaymentIntentNotFoundError(id));
            }
            console.error(error);
            return reject(error);
          }

          const incomingAmount = response.getIncomingAmount();
          const expiresAt = response.getExpiresAt();
          const destinationIlpAddress = response.getDestinationIlpAddress();

          return resolve({
            id: response.getId(),
            receiverWalletAddress: response.getWalletAddress(),
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
}
