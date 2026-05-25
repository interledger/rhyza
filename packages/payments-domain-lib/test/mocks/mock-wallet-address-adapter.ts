import {
  IWalletAddressService,
  IWalletAddress
} from '../../src/payment-intent/interfaces';

export class MockWalletAddressAdapter implements IWalletAddressService {
  private _walletAddresses: Map<string, IWalletAddress> = new Map();

  addWalletAddress(wallet: IWalletAddress): void {
    this._walletAddresses.set(wallet.id, wallet);
  }

  async fetchByIds(ids: string[]): Promise<IWalletAddress[]> {
    const results: IWalletAddress[] = [];
    for (const id of ids) {
      const w = this._walletAddresses.get(id);
      if (w) results.push(w);
    }
    return results;
  }
}
