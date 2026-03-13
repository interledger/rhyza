/*****
 Copyright © 2026 & Interledger Foundation
 ----------------------------------------------
 Contributors

 * Cyberbones Digital Solutions
 - Pedro Sousa Barreto <pedrosousabarreto@gmail.com>
 ******/

'use strict';

export interface IPalWalletAddressAlias {
  domain: string | null;
  pathName: string;
  walletId: string;
}

export interface IPalWalletAddressAliasRepository {
  store(alias: IPalWalletAddressAlias): Promise<void>;
  fetch(
    domain: string | null,
    pathName: string
  ): Promise<IPalWalletAddressAlias | null>;
}
