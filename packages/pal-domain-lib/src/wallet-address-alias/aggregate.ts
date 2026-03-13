/*****
 Copyright © 2026 & Interledger Foundation
 ----------------------------------------------
 Contributors

 * Cyberbones Digital Solutions
 - Pedro Sousa Barreto <pedrosousabarreto@gmail.com>
 ******/

'use strict';

import {
  IPalWalletAddressAlias,
  IPalWalletAddressAliasRepository
} from './interfaces';
import { CannotCreateDuplicateWalletAddressAliasError } from './errors';

export class WalletAddressAliasAggregate {
  private _repo: IPalWalletAddressAliasRepository;

  constructor(repo: IPalWalletAddressAliasRepository) {
    this._repo = repo;
  }

  async resolveWalletAddressAlias(
    domain: string | null,
    pathName: string
  ): Promise<string | null> {
    const found = await this._repo.fetch(domain || null, pathName);

    if (!found) return null;
    return found.walletId;
  }

  async createWalletAddressAlias(
    domain: string | null,
    pathName: string,
    walletId: string
  ): Promise<void> {
    const existing = await this._repo.fetch(domain || null, pathName);
    if (existing) {
      throw new CannotCreateDuplicateWalletAddressAliasError(
        'Wallet address alias already exists'
      );
    }

    // TODO: validate inputs, especially domain and pathName characters

    const alias: IPalWalletAddressAlias = {
      domain: domain || null,
      pathName,
      walletId
    };
    await this._repo.store(alias);
  }
}
