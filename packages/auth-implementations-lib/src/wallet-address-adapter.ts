'use strict';

import { JWK, createUnauthenticatedClient } from '@interledger/open-payments';

import { IWalletAddressService } from 'auth-domain-lib';

export class WalletAddressAdapter implements IWalletAddressService {
  async getWalletAddressKeys(walletAddressUrl: string): Promise<JWK[]> {
    try {
      const client = await createUnauthenticatedClient({});

      const { keys } = await client.walletAddress.getKeys({
        url: walletAddressUrl
      });

      return keys;
    } catch (err) {
      console.error(
        `Failed to retrieve wallet address keys: ${walletAddressUrl}, error: ${err}`
      );
      return [];
    }
  }

  async getWalletAddressPublicName(
    walletAddressUrl: string
  ): Promise<string | undefined> {
    try {
      const client = await createUnauthenticatedClient({});

      const { publicName } = await client.walletAddress.get({
        url: walletAddressUrl
      });

      return publicName;
    } catch (err) {
      console.error(
        `Failed to retrieve wallet address public name: ${walletAddressUrl}, error: ${err}`
      );
      return undefined;
    }
  }
}
