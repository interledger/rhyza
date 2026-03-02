/*****
 Copyright © 2026 & Interledger Foundation
 ----------------------------------------------
 Contributors

 * Cyberbones Digital Solutions
 - Pedro Sousa Barreto <pedrosousabarreto@gmail.com>
 ******/

'use strict';

export interface IPalWalletAddressAlias {
  prefix: string | null;
  suffix: string;
  walletId: string;
}

export interface IPalWalletAddressAliasAggregate {
  resolveWalletAddressId(prefix: string | null, suffix: string): Promise<string|null>;

  createWalletAddressAlias(
    prefix: string | null,
    suffix: string,
    walletId: string
  ): Promise<void>;
}

export interface IPalWalletAddressAliasRepository {
  store(alias: IPalWalletAddressAlias): Promise<void>;
  fetch(prefix: string|null, suffix:string): Promise<IPalWalletAddressAlias | null>;
}
