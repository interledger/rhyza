/*****
 Copyright © 2026 & Interledger Foundation
 ----------------------------------------------
 Contributors

 * Cyberbones Digital Solutions
 - Pedro Sousa Barreto <pedrosousabarreto@gmail.com>
 ******/

'use strict';

import { IPalWalletAddress } from './interfaces';

export class PalWalletAddress implements IPalWalletAddress {
  private readonly _id: string;
  private readonly _publicName: string;
  private readonly _assetCode: string;
  private readonly _assetScale: number;
  private readonly _isActive: boolean;

  constructor(
    id: string,
    publicName: string,
    assetCode: string,
    assetScale: number,
    isActive?: boolean
  ) {
    this._id = id;
    this._publicName = publicName;
    this._assetCode = assetCode;
    this._assetScale = assetScale;

    this._isActive = isActive == true || isActive == undefined;
  }

  static fromObject(json: IPalWalletAddress): PalWalletAddress {
    return new PalWalletAddress(
      json.id,
      json.publicName,
      json.assetCode,
      json.assetScale,
      json.isActive
    );
  }

  toObject(): IPalWalletAddress {
    return {
      id: this._id,
      publicName: this._publicName,
      assetCode: this._assetCode,
      assetScale: this._assetScale,
      isActive: this._isActive
    };
  }

  get id(): string {
    return this._id;
  }

  get publicName(): string {
    return this._publicName;
  }

  get assetCode(): string {
    return this._assetCode;
  }

  get assetScale(): number {
    return this._assetScale;
  }

  get isActive(): boolean {
    return this._isActive;
  }
}
