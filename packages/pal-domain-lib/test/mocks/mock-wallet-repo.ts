import { IPalWalletAddressDto } from 'pal-public-types-lib';
import { IPalWalletAddressRepository } from '../../src';

export class MockWalletRepo implements IPalWalletAddressRepository {
  private _data: Map<string, IPalWalletAddressDto> = new Map<
    string,
    IPalWalletAddressDto
  >();

  store(wallet: IPalWalletAddressDto): Promise<void> {
    this._data.set(wallet.id, wallet);
    return Promise.resolve();
  }

  fetch(ids: string[]): Promise<IPalWalletAddressDto[]> {
    const ret = Array.from(this._data.values()).filter((item) =>
      ids.includes(item.id)
    );
    return Promise.resolve(ret);
  }

  getByAlias(
    domain: string | null,
    pathName: string
  ): Promise<IPalWalletAddressDto | null> {
    let found: IPalWalletAddressDto | null = null;
    this._data.forEach((wallet) => {
      wallet.aliases.forEach((alias) => {
        if (alias.domain === domain && alias.pathName === pathName) {
          found = wallet;
          return;
        }
      });
    });
    return Promise.resolve(found);
  }
}
