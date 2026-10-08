import { IPalAssetDto } from 'pal-public-types-lib';

export interface IPalAssetRepository {
  store(asset: IPalAssetDto): Promise<IPalAssetDto>;
  fetch(codes?: string[]): Promise<IPalAssetDto[]>;
}
