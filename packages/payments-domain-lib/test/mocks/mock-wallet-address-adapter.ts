import {
  IWalletAddressAdapter,
  WalletAddress
} from '../../src/payment-intent/interfaces';

export class MockWalletAddressAdapter implements IWalletAddressAdapter {
  private _walletAddresses: Map<string, WalletAddress> = new Map();

  addWalletAddress(wallet: WalletAddress): void {
    this._walletAddresses.set(wallet.id, wallet);
  }

  async fetchByIds(ids: string[]): Promise<WalletAddress[]> {
    const results: WalletAddress[] = [];
    for (const id of ids) {
      const w = this._walletAddresses.get(id);
      if (w) results.push(w);
    }
    return results;
  }
}
