/*****
 Copyright © 2026 & Interledger Foundation
 ----------------------------------------------
 Contributors

 * Cyberbones Digital Solutions
 - Pedro Sousa Barreto <pedrosousabarreto@gmail.com>
 ******/

'use strict';

import { IPalWalletAddress, IPalWalletAddressRepository } from '../../src';

export class MockWalletRepo implements IPalWalletAddressRepository {
  private _data: Map<string, IPalWalletAddress> = new Map<
    string,
    IPalWalletAddress
  >();

  store(wallet: IPalWalletAddress): Promise<void> {
    this._data.set(wallet.id, wallet);
    return Promise.resolve();
  }

  fetch(ids: string[]): Promise<IPalWalletAddress[]> {
    const ret = Array.from(this._data.values()).filter((item) =>
      ids.includes(item.id)
    );
    return Promise.resolve(ret);
  }
}
