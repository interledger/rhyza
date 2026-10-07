import { IPalJsonWebKeyDto, IPalWalletAddressDto } from 'pal-public-types-lib';
import { PalWalletAddressAlias } from './wallet-address-alias';
import { PalWalletAddressKey } from './wallet-address-key';
import {
  CannotCreateDuplicateWalletAddressAliasError,
  DuplicateWalletAddressKeyError,
  WalletAddressKeyNotFoundError
} from '../errors';

export class PalWalletAddress implements IPalWalletAddressDto {
  private readonly _id: string;
  private readonly _publicName: string;
  private readonly _assetCode: string;
  private readonly _assetScale: number;
  private _isActive: boolean;
  private readonly _aliases: PalWalletAddressAlias[];
  private readonly _keys: PalWalletAddressKey[];

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
    this._keys = [];
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
    if (json.keys) {
      newObj.loadKeys(json.keys.map(PalWalletAddressKey.fromObject));
    }
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

  activate(): void {
    this._isActive = true;
  }

  deactivate(): void {
    this._isActive = false;
  }

  get aliases(): PalWalletAddressAlias[] {
    return this._aliases;
  }

  get keys(): PalWalletAddressKey[] {
    return this._keys;
  }

  loadKeys(keys: PalWalletAddressKey[]): void {
    this._keys.length = 0;
    this._keys.push(...keys);
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

  addKey(jwk: IPalJsonWebKeyDto): PalWalletAddressKey {
    const key = PalWalletAddressKey.create(this._id, jwk);

    const existing = this._keys.find(
      (stored) => stored.jwk.kid === key.jwk.kid
    );
    if (existing) {
      throw new DuplicateWalletAddressKeyError(
        `Wallet address key with kid ${key.jwk.kid} already exists`
      );
    }

    this._keys.push(key);
    return key;
  }

  revokeKey(keyId: string): Date {
    const key = this._keys.find((stored) => stored.id === keyId);
    if (!key) {
      throw new WalletAddressKeyNotFoundError(
        `Wallet address key ${keyId} does not exist for wallet ${this._id}`
      );
    }

    return key.revoke();
  }
}
