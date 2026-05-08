import { IPalAssetDto } from 'pal-public-types-lib';
import { IPalAssetRepository } from '../../src';

export class MockAssetRepo implements IPalAssetRepository {
  private _data: Map<string, IPalAssetDto> = new Map<string, IPalAssetDto>();

  store(asset: IPalAssetDto): Promise<void> {
    this._data.set(asset.code, asset);
    return Promise.resolve();
  }

  fetch(code: string): Promise<IPalAssetDto | null> {
    return Promise.resolve(this._data.get(code) ?? null);
  }
}
