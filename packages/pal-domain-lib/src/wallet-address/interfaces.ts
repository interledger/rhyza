import {
  IPalWalletAddressDto,
  IPalWalletAddressKeyDto
} from 'pal-public-types-lib';

// A wallet address whose keys have been loaded from the key store.
export type IPalWalletAddressWithKeysDto = IPalWalletAddressDto & {
  keys: IPalWalletAddressKeyDto[];
};

// fetch and getByAlias return wallets without keys.
// Use fetchWithKeys for anything that reads or changes keys.
export interface IPalWalletAddressRepository {
  store(walletAddress: IPalWalletAddressDto): Promise<void>;
  fetch(ids: string[]): Promise<IPalWalletAddressDto[]>;
  fetchWithKeys(id: string): Promise<IPalWalletAddressWithKeysDto | null>;

  getByAlias(
    domain: string | null,
    pathName: string
  ): Promise<IPalWalletAddressDto | null>;

  storeKey(key: IPalWalletAddressKeyDto): Promise<void>;
}
