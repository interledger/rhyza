import {
  AssetsApi,
  Configuration,
  GrantsApi,
  LiquidityApi,
  PaymentIntentsApi,
  PaymentsApi,
  PeersApi,
  QuotesApi,
  RatesApi,
  WalletAddressesApi
} from './generated';

export * from './generated/models/index';
export * from './generated/apis/index';

export interface AdminApiClient {
  peers: PeersApi;
  assets: AssetsApi;
  grants: GrantsApi;
  liquidity: LiquidityApi;
  paymentIntents: PaymentIntentsApi;
  payments: PaymentsApi;
  quotes: QuotesApi;
  rates: RatesApi;
  walletAddresses: WalletAddressesApi;
}

export function createAdminClient(
  baseUrl: string,
  apiKey?: string
): AdminApiClient {
  const configuration = new Configuration({
    basePath: baseUrl,
    apiKey
  });

  return {
    peers: new PeersApi(configuration),
    assets: new AssetsApi(configuration),
    grants: new GrantsApi(configuration),
    liquidity: new LiquidityApi(configuration),
    paymentIntents: new PaymentIntentsApi(configuration),
    payments: new PaymentsApi(configuration),
    quotes: new QuotesApi(configuration),
    rates: new RatesApi(configuration),
    walletAddresses: new WalletAddressesApi(configuration)
  };
}
