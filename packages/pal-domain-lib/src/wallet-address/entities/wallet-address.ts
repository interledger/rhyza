import { IPalWalletAddressDto } from 'pal-public-types-lib';
import { PalWalletAddressAlias } from './wallet-address-alias';
import { CannotCreateDuplicateWalletAddressAliasError } from '../errors';

export class PalWalletAddress implements IPalWalletAddressDto {
  private readonly _id: string;
  private readonly _publicName: string;
  private readonly _assetCode: string;
  private readonly _assetScale: number;
  private readonly _isActive: boolean;
  private readonly _aliases: PalWalletAddressAlias[];

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
    this._aliases = [];
  }

  static fromDto(json: IPalWalletAddressDto): PalWalletAddress {
    const newObj = new PalWalletAddress(
      json.id,
      json.publicName,
      json.assetCode,
      json.assetScale,
      json.isActive
    );
    newObj._aliases.push(
      ...json.aliases.map((alias) => PalWalletAddressAlias.fromObject(alias))
    );
    return newObj;
  }

  toDto(): IPalWalletAddressDto {
    return {
      id: this._id,
      publicName: this._publicName,
      assetCode: this._assetCode,
      assetScale: this._assetScale,
      isActive: this._isActive,
      aliases: this._aliases.map((a) => a.toObject())
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

  get aliases(): PalWalletAddressAlias[] {
    return this._aliases;
  }

  addAlias(domain: string | null, pathName: string): void {
    const existing = this._aliases.find(
      (alias) => alias.pathName === pathName && alias.domain === domain
    );

    if (existing) {
      throw new CannotCreateDuplicateWalletAddressAliasError(
        'Alias already exists'
      );
    }

    this._aliases.push(new PalWalletAddressAlias(domain, pathName, this._id));
  }
}
