/*****
 Copyright © 2026 & Interledger Foundation
 ----------------------------------------------
 Contributors

 * Cyberbones Digital Solutions
 - Pedro Sousa Barreto <pedrosousabarreto@gmail.com>
 ******/

'use strict';

import { CannotCreateDuplicateWalletAddressError } from './errors';
import { IPalWalletAddress, IPalWalletAddressRepository } from './interfaces';
import { PalWalletAddress } from './entity';

export class WalletAddressAggregate {
  private _repo: IPalWalletAddressRepository;

  constructor(repo: IPalWalletAddressRepository) {
    this._repo = repo;
  }

  async createWalletAddress(
    id: string,
    publicName: string,
    assetCode: string,
    assetScale: number,
    isActive: boolean = true
  ): Promise<string> {
    const existing = await this._repo.fetch([id]);

    if (existing.length > 0) {
      throw new CannotCreateDuplicateWalletAddressError(
        'Wallet with id: ' + id + ' already exists'
      );
    }

    // TODO: validate inputs

    const newWallet = new PalWalletAddress(
      id,
      publicName,
      assetCode,
      assetScale,
      isActive
    );

    await this._repo.store(newWallet.toObject());

    return newWallet.id;
  }

  async getWalletAddresses(ids: string[]): Promise<IPalWalletAddress[]> {
    const found = await this._repo.fetch(ids);

    if (!found || found.length == 0) return [];

    return found.map(PalWalletAddress.fromObject);
  }
}
