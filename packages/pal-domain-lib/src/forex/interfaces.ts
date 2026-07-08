import { IPalFxRateDto } from 'pal-public-types-lib';

export interface IPalFxRepository {
  fetch(ids: string[]): Promise<IPalFxRateDto[]>;

  store(fxRate: IPalFxRateDto): Promise<void>;
}

export interface IPalAseFxService {
  getIntraAseFxRate(
    sourceAssetCode: string,
    destinationAssetCode: string
  ): Promise<{ rate: number; expiresAt: number }>;
  getPeerFxFromAse(
    sourceAssetCode: string,
    destinationAssetCode: string,
    peerId: string
  ): Promise<{ rate: number; expiresAt: number }>;
}

export interface IPalFxCacheExpiryService {
  setExpiry(rateId: string, expiresAt: number): Promise<void>;
  clearExpiry(rateId: string): Promise<void>;
}
