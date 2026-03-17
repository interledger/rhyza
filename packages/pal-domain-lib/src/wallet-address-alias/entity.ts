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
  private readonly _domain: string | null;
  private readonly _pathName: string;
  private readonly _walletId: string;

  constructor(domain: string | null, pathName: string, walletId: string) {
    this._domain = domain;
    this._pathName = pathName;
    this._walletId = walletId;
  }

  get domain(): string | null {
    return this._domain;
  }

  get pathName(): string {
    return this._pathName;
  }

  get walletId(): string {
    return this._walletId;
  }

  static fromObject(json: IPalWalletAddressAlias): PalWalletAddressAlias {
    return new PalWalletAddressAlias(json.domain, json.pathName, json.walletId);
  }

  toObject(): IPalWalletAddressAlias {
    return {
      domain: this._domain,
      pathName: this._pathName,
      walletId: this._walletId
    };
  }
}
