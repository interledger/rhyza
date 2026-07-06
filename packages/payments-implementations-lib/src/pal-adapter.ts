import {
  IFxRateRequest,
  IPalService,
  IPeer,
  IWalletAddress
} from 'payments-domain-lib';
import { PalClient } from 'pal-client-lib';

export class PalAdapter implements IPalService {
  constructor(private _palClient: PalClient) {}

  async getWalletAddresses(ids: string[]): Promise<IWalletAddress[]> {
    if (ids.length === 0) return [];

    const results = await this._palClient.getWalletAddresses(ids);

    return results.map((w) => ({
      id: w.id,
      isActive: w.isActive,
      assetCode: w.assetCode,
      assetScale: w.assetScale
    }));
  }

  async getPeerByIlpAddress(ilpAddress: string): Promise<IPeer | null> {
    const peer = await this._palClient.getPeerByIlpAddress(ilpAddress);
    if (!peer) return null;

    return {
      peerId: peer.id,
      assetCode: peer.assetCode,
      assetScale: peer.assetScale
    };
  }

  async getRates(request: IFxRateRequest): Promise<number | null> {
    return this._palClient.getFxRate(request);
  }
}
