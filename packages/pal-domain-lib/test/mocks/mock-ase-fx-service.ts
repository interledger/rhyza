import { IPalPeerAseFxService, IPalPeerFxRate } from '../../src';

export class MockAseFxService implements IPalPeerAseFxService {
  rates: IPalPeerFxRate[];
  defaultExpirationMs: number = 1 * 60 * 60 * 1000; // 1 hour
  defaultRate: number = 1.0;

  async getFxFromAse(
    sourceAssetCode: string,
    destinationAssetCode: string
  ): Promise<{ rate: number; expiresAt: number }> {
    const rate = this.rates?.find(
      (r) =>
        r.sourceAssetCode === sourceAssetCode &&
        r.destinationAssetCode === destinationAssetCode
    );

    if (rate) {
      return { rate: rate.rate, expiresAt: rate.expiresAt };
    }

    return {
      rate: this.defaultRate,
      expiresAt: Date.now() + this.defaultExpirationMs
    };
  }
}
