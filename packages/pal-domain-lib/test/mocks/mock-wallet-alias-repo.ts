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
} from '../../src';

export class MockWalletAddressAliasRepo
  implements IPalWalletAddressAliasRepository
{
  private _data: IPalWalletAddressAlias[] = [];

  store(alias: IPalWalletAddressAlias): Promise<void> {
    this._data.push(alias);
    return Promise.resolve();
  }

  fetch(
    prefix: string | null,
    suffix: string
  ): Promise<IPalWalletAddressAlias | null> {
    const ret = this._data.find(
      (item) => item.prefix === prefix && item.suffix === suffix
    );
    return Promise.resolve(ret);
  }
}
