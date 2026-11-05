import {
  IRemotePaymentIntentDetails,
  IRemotePaymentIntentService,
  PaymentIntentDestination,
  PaymentIntentState
} from '../../src/payment-intent/interfaces';

type IncomingPaymentAmount = {
  value: string;
  assetCode: string;
  assetScale: number;
};

type IncomingPaymentWithMethods = {
  id: string;
  completed: boolean;
  walletAddress?: string;
  createdAt: string;
  receivedAmount: IncomingPaymentAmount;
  incomingAmount?: IncomingPaymentAmount;
  expiresAt?: string;
  methods: {
    type: 'ilp';
    ilpAddress: string;
    sharedSecret: string;
  }[];
};

export function toIncomingPaymentWithMethods(
  overrides: Partial<IncomingPaymentWithMethods> &
    Partial<{
      assetCode: string;
      assetScale: number;
      ilpAddress: string;
      sharedSecret: string;
      receivedAmountValue: string;
      incomingAmountValue: string;
    }> = {}
): IncomingPaymentWithMethods {
  const assetCode = overrides.assetCode ?? 'USD';
  const assetScale = overrides.assetScale ?? 2;
  const receivedAmountValue = overrides.receivedAmountValue ?? '0';

  const response: IncomingPaymentWithMethods = {
    id: overrides.id ?? crypto.randomUUID(),
    completed: overrides.completed ?? false,
    walletAddress: overrides.walletAddress ?? 'remote.domain.com/alice',
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    receivedAmount: overrides.receivedAmount ?? {
      value: receivedAmountValue,
      assetCode,
      assetScale
    },
    expiresAt:
      overrides.expiresAt ?? new Date(Date.now() + 60_000).toISOString(),
    methods: overrides.methods ?? [
      {
        type: 'ilp',
        ilpAddress: overrides.ilpAddress ?? 'g.peer.123',
        sharedSecret: overrides.sharedSecret ?? 'stub-shared-secret'
      }
    ]
  };

  if (overrides.incomingAmount) {
    response.incomingAmount = overrides.incomingAmount;
  } else if (overrides.incomingAmountValue !== undefined) {
    response.incomingAmount = {
      value: overrides.incomingAmountValue,
      assetCode,
      assetScale
    };
  }

  return response;
}

export function stubRemotePaymentIntent(
  overrides: Partial<IRemotePaymentIntentDetails> = {}
): IRemotePaymentIntentDetails {
  const now = new Date();
  return {
    id: 'remote-intent',
    destination: PaymentIntentDestination.REMOTE,
    remoteUrl: 'https://remote.domain.com/incoming-payments/abc',
    receiverWalletAddress: 'remote.domain.com/alice',
    state: PaymentIntentState.CREATED,
    assetCode: 'USD',
    assetScale: 2,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
    incomingAmount: null,
    receivedAmount: 0n,
    quotes: [],
    sentPayments: [],
    inboundPayments: [],
    destinationIlpAddress: 'g.peer.123',
    sharedSecret: 'stub-shared-secret',
    ...overrides
  };
}

// mirrors RemotePaymentIntentAdapter return data structure
export function toRemotePaymentIntentDetails(
  data: IncomingPaymentWithMethods,
  url: string
): IRemotePaymentIntentDetails {
  const ilpMethod = data.methods.find((method) => method.type === 'ilp');
  if (!ilpMethod?.sharedSecret) {
    throw new Error(
      'Remote incoming payment response missing ILP sharedSecret'
    );
  }
  if (!ilpMethod.ilpAddress) {
    throw new Error('Remote incoming payment response missing ILP ilpAddress');
  }

  return {
    id: data.id,
    destination: PaymentIntentDestination.REMOTE,
    remoteUrl: url,
    receiverWalletAddress: data.walletAddress,
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

export class MockRemotePaymentIntentService
  implements IRemotePaymentIntentService
{
  private response: IncomingPaymentWithMethods | null = null;

  setIncomingPaymentResponse(
    response: IncomingPaymentWithMethods | null
  ): void {
    this.response = response;
  }

  async fetchPaymentIntent(url: string): Promise<IRemotePaymentIntentDetails> {
    if (!this.response) {
      throw new Error('Not implemented');
    }
    return toRemotePaymentIntentDetails(this.response, url);
  }
}
