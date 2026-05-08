import { IPalAssetDto } from 'pal-public-types-lib';

export interface IPalAssetRepository {
  store(asset: IPalAssetDto): Promise<void>;
  fetch(code: string): Promise<IPalAssetDto | null>;
}
