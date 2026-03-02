/*****
 Copyright © 2026 & Interledger Foundation
 ----------------------------------------------
 Contributors

 * Cyberbones Digital Solutions
 - Pedro Sousa Barreto <pedrosousabarreto@gmail.com>
 ******/

'use strict';

export interface IPalWalletAddress {
  id: string;
  publicName: string;
  assetCode: string;
  assetScale: number;
  isActive: boolean;
}

export interface IWalletAddressAggregate {
  createWalletAddress(
    id: string,
    publicName: string,
    assetCode: string,
    assetScale: number,
    isActive?: boolean
  ): Promise<string>;
  getWalletAddresses(ids: string[]): Promise<IPalWalletAddress[]>;
}

export interface IPalWalletAddressRepository {
  store(walletAddress: IPalWalletAddress): Promise<void>;
  fetch(ids: string[]): Promise<IPalWalletAddress[]>;
}
