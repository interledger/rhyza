import {
  IFxRateRequest,
  IPalService,
  IPeer,
  IWalletAddress
} from '../../src/payment-intent/interfaces';

export class MockPalService implements IPalService {
  private _walletAddresses: Map<string, IWalletAddress> = new Map();

  addWalletAddress(wallet: IWalletAddress): void {
    this._walletAddresses.set(wallet.id, wallet);
  }

  async getWalletAddresses(ids: string[]): Promise<IWalletAddress[]> {
    const results: IWalletAddress[] = [];
    for (const id of ids) {
      const w = this._walletAddresses.get(id);
      if (w) results.push(w);
    }
    return results;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getPeerByIlpAddress(_ilpAddress: string): Promise<IPeer | null> {
    return { peerId: 'peer-1', assetCode: 'USD', assetScale: 2 };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getRates(_request: IFxRateRequest): Promise<number | null> {
    return 1;
  }
}
