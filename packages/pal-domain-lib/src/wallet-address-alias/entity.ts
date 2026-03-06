/*****
 Copyright © 2026 & Interledger Foundation
 ----------------------------------------------
 Contributors

 * Cyberbones Digital Solutions
 - Pedro Sousa Barreto <pedrosousabarreto@gmail.com>
 ******/

'use strict';

import { IPalWalletAddressAlias } from './interfaces';

export class PalWalletAddressAlias implements IPalWalletAddressAlias {
  private readonly _prefix: string | null;
  private readonly _suffix: string;
  private readonly _walletId: string;

  constructor(prefix: string | null, suffix: string, walletId: string) {
    this._prefix = prefix;
    this._suffix = suffix;
    this._walletId = walletId;
  }

  get prefix(): string | null {
    return this._prefix;
  }

  get suffix(): string {
    return this._suffix;
  }

  get walletId(): string {
    return this._walletId;
  }

  static fromObject(json: IPalWalletAddressAlias): PalWalletAddressAlias {
    return new PalWalletAddressAlias(json.prefix, json.suffix, json.walletId);
  }

  toObject(): IPalWalletAddressAlias {
    return {
      prefix: this._prefix,
      suffix: this._suffix,
      walletId: this._walletId
    };
  }
}
