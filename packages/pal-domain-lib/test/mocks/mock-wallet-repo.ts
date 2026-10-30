import {
  IPalWalletAddressDto,
  IPalWalletAddressKeyDto
} from 'pal-public-types-lib';
import {
  DuplicateWalletAddressKeyError,
  IPalWalletAddressRepository,
  IPalWalletAddressWithKeysDto
} from '../../src';

export class MockWalletRepo implements IPalWalletAddressRepository {
  private _data: Map<string, IPalWalletAddressDto> = new Map<
    string,
    IPalWalletAddressDto
  >();
  private _keys: Map<string, IPalWalletAddressKeyDto[]> = new Map();

  store(wallet: IPalWalletAddressDto): Promise<void> {
    this._data.set(wallet.id, {
      id: wallet.id,
      publicName: wallet.publicName,
      assetCode: wallet.assetCode,
      assetScale: wallet.assetScale,
      isActive: wallet.isActive,
      aliases: wallet.aliases
    });
    return Promise.resolve();
  }

  storeKey(key: IPalWalletAddressKeyDto): Promise<void> {
    const existing = this._keys.get(key.walletAddressId) ?? [];
    const index = existing.findIndex((stored) => stored.id === key.id);
    if (index >= 0) {
      const next = [...existing];
      next[index] = key;
      this._keys.set(key.walletAddressId, next);
      return Promise.resolve();
    }

    if (existing.some((stored) => stored.jwk.kid === key.jwk.kid)) {
      throw new DuplicateWalletAddressKeyError(
        `Wallet address key with kid ${key.jwk.kid} already exists`
      );
    }

    this._keys.set(key.walletAddressId, [...existing, key]);
    return Promise.resolve();
  }

  fetch(ids: string[]): Promise<IPalWalletAddressDto[]> {
    const ret = Array.from(this._data.values())
      .filter((item) => ids.includes(item.id))
      .map((wallet) => ({ ...wallet }));
    return Promise.resolve(ret);
  }

  fetchWithKeys(id: string): Promise<IPalWalletAddressWithKeysDto | null> {
    const wallet = this._data.get(id);
    if (!wallet) return Promise.resolve(null);

    return Promise.resolve({
      ...wallet,
      keys: [...(this._keys.get(id) ?? [])]
    });
  }

  getByAlias(
    domain: string | null,
    pathName: string
  ): Promise<IPalWalletAddressDto | null> {
    const found = Array.from(this._data.values()).find((wallet) =>
      wallet.aliases.some(
        (alias) => alias.domain === domain && alias.pathName === pathName
      )
    );
    return Promise.resolve(found ? { ...found } : null);
  }
}
