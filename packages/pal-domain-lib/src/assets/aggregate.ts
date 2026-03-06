/*****
 Copyright © 2026 & Interledger Foundation
 ----------------------------------------------
 Contributors

 * Cyberbones Digital Solutions
 - Pedro Sousa Barreto <pedrosousabarreto@gmail.com>
 ******/

'use strict';

import { CannotCreateDuplicateAssetError } from './errors';
import { IPalAssetRepository } from './interfaces';
import { PalAsset } from './entity';

export class AssetAggregate {
  private _repo: IPalAssetRepository;

  constructor(repo: IPalAssetRepository) {
    this._repo = repo;
  }

  async createAsset(
    code: string,
    scale: number,
    liquidityLowThreshold: bigint | null = null,
    liquidityHighThreshold: bigint | null = null
  ): Promise<void> {
    const existing = await this._repo.fetch(code);

    if (existing)
      throw new CannotCreateDuplicateAssetError(
        'Asset with code: ' + code + ' already exists'
      );

    // TODO: validate inputs

    const newAsset = new PalAsset(
      code,
      scale,
      liquidityLowThreshold,
      liquidityHighThreshold
    );

    await this._repo.store(newAsset.toObject());
  }

  async getAsset(code: string): Promise<PalAsset | null> {
    const found = await this._repo.fetch(code);

    if (!found) return null;

    return PalAsset.fromObject(found);
  }
}
