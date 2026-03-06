/*****
 Copyright © 2026 & Interledger Foundation
 ----------------------------------------------
 Contributors

 * Cyberbones Digital Solutions
 - Pedro Sousa Barreto <pedrosousabarreto@gmail.com>
 ******/

'use strict';

// for returned assets objects
export interface IPalClientAsset {
  code: string;
  scale: number;
  liquidityLowThreshold: bigint | null;
  liquidityHighThreshold: bigint | null;
}

// for returned wallet address objects
export interface IPalClientWalletAddress {
  address: string;
  publicName: string;
  assetCode: string;
  assetScale: number;
  isActive: boolean;
}

/**
 * This object includes the internal wallet address id,
 * should be used internally only
 */
export interface IGetWalletAddressResponse {
  id: string;
  publicName: string;
  assetCode: string;
  assetScale: number;
  isActive: boolean;
}
