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
    prefix: string | null,
    suffix: string
  ): Promise<string | null> {
    const found = await this._repo.fetch(prefix || null, suffix);

    if (!found) return null;
    return found.walletId;
  }

  async createWalletAddressAlias(
    prefix: string | null,
    suffix: string,
    walletId: string
  ): Promise<void> {
    const existing = await this._repo.fetch(prefix || null, suffix);
    if (existing) {
      throw new CannotCreateDuplicateWalletAddressAliasError(
        'Wallet address alias already exists'
      );
    }

    // TODO: validate inputs, especially prefix and suffix characters

    const alias: IPalWalletAddressAlias = {
      prefix: prefix || null,
      suffix,
      walletId
    };
    await this._repo.store(alias);
  }
}
