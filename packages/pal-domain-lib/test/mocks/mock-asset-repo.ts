/*****
 Copyright © 2026 & Interledger Foundation
 ----------------------------------------------
 Contributors

 * Cyberbones Digital Solutions
 - Pedro Sousa Barreto <pedrosousabarreto@gmail.com>
 ******/

'use strict';

import { IPalAsset, IPalAssetRepository } from '../../src';

export class MockAssetRepo implements IPalAssetRepository {
  private _data: Map<string, IPalAsset> = new Map<string, IPalAsset>();

  store(asset: IPalAsset): Promise<void> {
    this._data.set(asset.code, asset);
    return Promise.resolve();
  }

  fetch(code: string): Promise<IPalAsset | null> {
    return Promise.resolve(this._data.get(code) ?? null);
  }
}
