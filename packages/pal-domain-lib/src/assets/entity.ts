import { IPalAssetDto } from 'pal-public-types-lib';

export class PalAsset {
  private readonly _code: string;
  private readonly _scale: number;
  private _ledgerAccountId: string | null;

  constructor(
    code: string,
    scale: number,
    ledgerAccountId: string | null = null
  ) {
    this._code = code;
    this._scale = scale;
    this._ledgerAccountId = ledgerAccountId;
  }

  static fromDto(json: IPalAssetDto): PalAsset {
    return new PalAsset(json.code, json.scale, json.ledgerAccountId);
  }

  toDto(): IPalAssetDto {
    return {
      code: this._code,
      scale: this._scale,
      ledgerAccountId: this._ledgerAccountId
    };
  }

  get code(): string {
    return this._code;
  }

  get scale(): number {
    return this._scale;
  }

  get ledgerAccountId(): string | null {
    return this._ledgerAccountId;
  }

  associateLedgerAccount(ledgerAccountId: string): void {
    this._ledgerAccountId = ledgerAccountId;
  }
}
