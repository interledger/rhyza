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

  /**
   * Creates a wallet address, coordinating this request with the wallet address alias
   * aggregate, to automatically register the alias of the newly created address
   * @param domain Optional domain part for wallet address
   * @param pathName Mandatory pathName part for wallet address
   * @param publicName Wallet address public name
   * @param assetCode Asset code
   * @param assetScale Asset code
   * @param isActive optional param to set wallet as active or inactive
   * @returns internal wallet address ID (should not be shared outside)
   */
  async createWalletAddress(
    domain: string | null,
    pathName: string,
    publicName: string,
    assetCode: string,
    assetScale: number,
    isActive?: boolean
  ): Promise<string> {
    const alias = await this._aliasAggregate.resolveWalletAddressAlias(
      domain,
      pathName
    );

    if (alias) {
      throw new CannotCreateDuplicateWalletAddressError(
        `Wallet Address with that domain and pathName ${domain}/${pathName} already exists`
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
    await this.createWalletAddressAlias(domain, pathName, newAddressId);

    return newAddressId;
  }

  /**
   * Creates a wallet address alias, coordinating this request with the wallet address
   * aggregate by validating the existence of the proposed wallet address id.
   * @param domain optional alias domain
   * @param pathName alias pathName
   * @param walletId target wallet address id for the alias to point to
   */

  async createWalletAddressAlias(
    domain: string | null,
    pathName: string,
    walletId: string
  ): Promise<void> {
    const [walletAddress] = await this._addressAggregate.getWalletAddresses([
      walletId
    ]);

    if (!walletAddress) {
      throw new Error(`Wallet Address with id ${walletId} does not exist`);
    }

    // Note: the alias aggregate already checks for duplicates
    await this._aliasAggregate.createWalletAddressAlias(
      domain,
      pathName,
      walletId
    );
  }
}
