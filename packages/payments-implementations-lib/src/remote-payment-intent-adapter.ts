'use strict';

import {
  IRemotePaymentIntentService,
  PaymentIntentDestination,
  PaymentIntentState
} from 'payments-domain-lib';

import type { IRemotePaymentIntentDetails } from 'payments-domain-lib';

type IncomingPaymentAmount = {
  value: string;
  assetCode: string;
  assetScale: number;
};

type IncomingPaymentWithoutAccessToken = {
  id: string;
  completed: boolean;
  createdAt: string;
  receivedAmount: IncomingPaymentAmount;
  incomingAmount?: IncomingPaymentAmount;
  expiresAt?: string;
  authServer: string;
  methods: {
    type: 'ilp';
    ilpAddress: string;
    sharedSecret: string;
  }[];
};

// TODO: Consider replacing fetch with the open-payments-node client.
// That would require either: (a) key pair initialization for authenticated
// requests, or (b) the remote server exposing asset details on the public
// incoming payment endpoint (e.g., excluding only receiver wallet address).
// Ideally we shouldn't need to make an authenticated request for this.
export class RemotePaymentIntentAdapter implements IRemotePaymentIntentService {
  async fetchPaymentIntent(url: string): Promise<IRemotePaymentIntentDetails> {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch remote incoming payment at ${url}: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as IncomingPaymentWithoutAccessToken;

    const ilpMethod = data.methods?.find((method) => method.type === 'ilp');
    if (!ilpMethod?.sharedSecret) {
      throw new Error(
        `Remote incoming payment ${url} response missing ILP sharedSecret`
      );
    }

    if (!ilpMethod.ilpAddress) {
      throw new Error(
        `Remote incoming payment ${url} response missing ILP ilpAddress`
      );
    }

    return {
      id: data.id,
      destination: PaymentIntentDestination.REMOTE,
      remoteUrl: url,
      state: data.completed
        ? PaymentIntentState.COMPLETED
        : PaymentIntentState.CREATED,
      assetCode: data.receivedAmount.assetCode,
      assetScale: data.receivedAmount.assetScale,
      createdAt: new Date(data.createdAt),
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      incomingAmount: data.incomingAmount
        ? BigInt(data.incomingAmount.value)
        : null,
      receivedAmount: BigInt(data.receivedAmount.value),
      quotes: [],
      sentPayments: [],
      inboundPayments: [],
      destinationIlpAddress: ilpMethod.ilpAddress,
      sharedSecret: ilpMethod.sharedSecret
    };
  }
}
