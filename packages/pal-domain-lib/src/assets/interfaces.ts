/*****
 Copyright © 2026 & Interledger Foundation
 ----------------------------------------------
 Contributors

 * Cyberbones Digital Solutions
 - Pedro Sousa Barreto <pedrosousabarreto@gmail.com>
 ******/

'use strict';

export interface IPalAsset {
  code: string;
  scale: number;
  liquidityLowThreshold: bigint | null;
  liquidityHighThreshold: bigint | null;
}

export interface IPalAssetRepository {
  store(asset: IPalAsset): Promise<void>;
  fetch(code: string): Promise<IPalAsset | null>;
}
