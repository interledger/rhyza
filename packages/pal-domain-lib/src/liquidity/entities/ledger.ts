import { ILedgerDto } from 'pal-public-types-lib';

export interface ILedger {
  id: string;
  version: bigint;
  assetScale: number;
}

export class LedgerDtoSerializer {
  static toDTO(ledger: ILedger): ILedgerDto {
    return {
      id: ledger.id,
      assetScale: ledger.assetScale,
      version: ledger.version.toString()
    };
  }
  static fromDTO(dto: ILedgerDto): ILedger {
    return {
      id: dto.id,
      assetScale: dto.assetScale,
      version: BigInt(dto.version)
    };
  }
}
