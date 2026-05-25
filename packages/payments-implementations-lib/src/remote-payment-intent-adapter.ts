'use strict';

import {
  IRemotePaymentIntentService,
  IRemotePaymentIntentDetails
} from 'payments-domain-lib';

// TODO: fetch from peer/node config once ILP addressing is wired up
const STUB_DESTINATION_ILP_ADDRESS = 'ilp.rafiki.0';

// TODO: Consider replacing fetch with the open-payments-node client.
// That would require either: (a) key pair initialization for authenticated
// requests, or (b) the remote server exposing asset details on the public
// incoming payment endpoint (e.g., excluding only receiver wallet address).
// Ideally we shouldn't need to make an authenticated request for this.
export class RemotePaymentIntentAdapter implements IRemotePaymentIntentService {
  async fetchIncomingPayment(
    url: string
  ): Promise<IRemotePaymentIntentDetails> {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch remote incoming payment at ${url}: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as {
      walletAddress: string;
      incomingAmount?: { value: string; assetCode: string; assetScale: number };
      receivedAmount: { value: string; assetCode: string; assetScale: number };
      expiresAt?: string;
      destinationIlpAddress?: string;
    };

    return {
      walletAddress: data.walletAddress,
      assetCode: data.receivedAmount.assetCode,
      assetScale: data.receivedAmount.assetScale,
      incomingAmount: data.incomingAmount
        ? BigInt(data.incomingAmount.value)
        : undefined,
      receivedAmount: BigInt(data.receivedAmount.value),
      expiresAt: data.expiresAt,
      destinationIlpAddress:
        data.destinationIlpAddress ?? STUB_DESTINATION_ILP_ADDRESS
    };
  }
}
