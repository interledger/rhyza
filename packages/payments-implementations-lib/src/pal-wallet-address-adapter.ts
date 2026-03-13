import { IWalletAddressAdapter, WalletAddress } from 'payments-domain-lib';
import { PalClient } from 'pal-client-lib';

export class PalWalletAddressAdapter implements IWalletAddressAdapter {
  private _palClient: PalClient;

  constructor(palClient: PalClient) {
    this._palClient = palClient;
  }

  async fetchByIds(ids: string[]): Promise<WalletAddress[]> {
    if (ids.length === 0) return [];

    const results = await this._palClient.getWalletAddresses(ids);

    return results.map((w) => ({
      id: w.id,
      isActive: w.isActive,
      assetCode: w.assetCode,
      assetScale: w.assetScale
    }));
  }
}
