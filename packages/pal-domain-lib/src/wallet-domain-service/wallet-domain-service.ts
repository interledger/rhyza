/*****
 Copyright © 2026 & Interledger Foundation
 ----------------------------------------------
 Contributors

 * Cyberbones Digital Solutions
 - Pedro Sousa Barreto <pedrosousabarreto@gmail.com>
 ******/

'use strict';

import {
  CannotCreateDuplicateWalletAddressError,
  WalletAddressAggregate
} from '../wallet-address';
import { WalletAddressAliasAggregate } from '../wallet-address-alias';
import * as crypto from 'node:crypto';

const ADDRESS_SPLIT_CHAR = '/';

export class WalletDomainService {
  private _addressAggregate: WalletAddressAggregate;
  private _aliasAggregate: WalletAddressAliasAggregate;

  constructor(
    addressAggregate: WalletAddressAggregate,
    aliasAggregate: WalletAddressAliasAggregate
  ) {
    this._addressAggregate = addressAggregate;
    this._aliasAggregate = aliasAggregate;
  }

  private _extractPrefixAndSuffixFromAddress(address: string): {
    prefix: string | null;
    suffix: string;
  } {
    let prefix = null;
    let suffix = address;
    const lastIndex = address.lastIndexOf(ADDRESS_SPLIT_CHAR);

    if (lastIndex >= -1) {
      prefix = address.substring(0, lastIndex);
      suffix = address.substring(lastIndex + 1);
    }

    return { prefix, suffix };
  }

  /**
   * Creates a wallet address, coordinating this request with the wallet address alias
   * aggregate, to automatically register the alias of the newly created address
   * @param address Requested wallet address
   * @param publicName Wallet address public name
   * @param assetCode Asset code
   * @param assetScale Asset code
   * @param isActive optional param to set wallet as active or inactive
   * @returns internal wallet address ID (should not be shared outside)
   */
  async createWalletAddress(
    address: string,
    publicName: string,
    assetCode: string,
    assetScale: number,
    isActive?: boolean
  ): Promise<string> {
    const prefixAndSuffix = this._extractPrefixAndSuffixFromAddress(address);
    const alias = await this._aliasAggregate.resolveWalletAddressAlias(
      prefixAndSuffix.prefix,
      prefixAndSuffix.suffix
    );

    if (alias) {
      throw new CannotCreateDuplicateWalletAddressError(
        `Wallet Address with address ${address} already exists`
      );
    }

    const newAddressId = crypto.randomUUID();
    await this._addressAggregate.createWalletAddress(
      newAddressId,
      publicName,
      assetCode,
      assetScale,
      isActive
    );
    await this.createWalletAddressAlias(
      prefixAndSuffix.prefix,
      prefixAndSuffix.suffix,
      newAddressId
    );

    return newAddressId;
  }

  /**
   * Creates a wallet address alias, coordinating this request with the wallet address
   * aggregate by validating the existence of the proposed wallet address id.
   * @param prefix optional alias prefix
   * @param suffix alias suffix
   * @param walletId target wallet address id for the alias to point to
   */

  async createWalletAddressAlias(
    prefix: string | null,
    suffix: string,
    walletId: string
  ): Promise<void> {
    const [walletAddress] = await this._addressAggregate.getWalletAddresses([
      walletId
    ]);

    if (!walletAddress) {
      throw new Error(`Wallet Address with id ${walletId} does not exist`);
    }

    // note: the alias aggregate already checks for duplicates
    await this._aliasAggregate.createWalletAddressAlias(
      prefix,
      suffix,
      walletId
    );
  }
}
