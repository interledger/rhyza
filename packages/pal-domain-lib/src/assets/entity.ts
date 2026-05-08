import { IPalAssetDto } from 'pal-public-types-lib';

export class PalAsset {
  private _code: string;
  private _scale: number;
  private _liquidityLowThreshold: bigint | null;
  private _liquidityHighThreshold: bigint | null;
  private _ledgerAccountId: string | null;

  constructor(
    code: string,
    scale: number,
    liquidityLowThreshold: bigint | null = null,
    liquidityHighThreshold: bigint | null = null,
    ledgerAccountId: string | null = null
  ) {
    this._code = code;
    this._scale = scale;
    this._liquidityLowThreshold = liquidityLowThreshold;
    this._liquidityHighThreshold = liquidityHighThreshold;
    this._ledgerAccountId = ledgerAccountId;
  }

  static fromDto(json: IPalAssetDto): PalAsset {
    return new PalAsset(
      json.code,
      json.scale,
      json.liquidityLowThreshold,
      json.liquidityHighThreshold,
      json.ledgerAccountId
    );
  }

  toDto(): IPalAssetDto {
    return {
      code: this._code,
      scale: this._scale,
      liquidityLowThreshold: this._liquidityLowThreshold,
      liquidityHighThreshold: this._liquidityHighThreshold,
      ledgerAccountId: this._ledgerAccountId
    };
  }

  get code(): string {
    return this._code;
  }

  get scale(): number {
    return this._scale;
  }

  get liquidityLowThreshold(): bigint | null {
    return this._liquidityLowThreshold;
  }

  get liquidityHighThreshold(): bigint | null {
    return this._liquidityHighThreshold;
  }
  get ledgerAccountId(): string | null {
    return this._ledgerAccountId;
  }

  associateLedgerAccount(ledgerAccountId: string): void {
    this._ledgerAccountId = ledgerAccountId;
  }
}
