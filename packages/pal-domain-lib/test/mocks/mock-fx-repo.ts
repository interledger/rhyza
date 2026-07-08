import { IPalFxRateDto } from 'pal-public-types-lib';
import { IPalFxRepository } from '../../src';

export class MockFxRepo implements IPalFxRepository {
  private _data: Map<string, IPalFxRateDto> = new Map<string, IPalFxRateDto>();

  store(dto: IPalFxRateDto): Promise<void> {
    this._data.set(dto.id, dto);
    return Promise.resolve();
  }

  fetch(ids: string[]): Promise<IPalFxRateDto[]> {
    const ret = Array.from(this._data.values()).filter((item) =>
      ids.includes(item.id)
    );

    return Promise.resolve(ret);
  }
}
