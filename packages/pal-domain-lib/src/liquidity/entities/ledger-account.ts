import { ILedgerAccountDto } from 'pal-public-types-lib';

export interface ILedgerAccount {
  id: string;
  name: string;
  assetCode: string;
  assetDisplayScale: number;
  debitedAmount: bigint;
  creditedAmount: bigint;
  externalId?: string;
}

export class LedgerAccountDtoSerializer {
  static toDTO(ledgerAccount: ILedgerAccount): ILedgerAccountDto {
    return {
      id: ledgerAccount.id,
      name: ledgerAccount.name,
      assetCode: ledgerAccount.assetCode,
      assetDisplayScale: ledgerAccount.assetDisplayScale,
      debitedAmount: ledgerAccount.debitedAmount.toString(),
      creditedAmount: ledgerAccount.creditedAmount.toString(),
      externalId: ledgerAccount.externalId
    };
  }
  static fromDTO(dto: ILedgerAccountDto): ILedgerAccount {
    return {
      id: dto.id,
      name: dto.name,
      assetCode: dto.assetCode,
      assetDisplayScale: dto.assetDisplayScale,
      debitedAmount: BigInt(dto.debitedAmount),
      creditedAmount: BigInt(dto.creditedAmount),
      externalId: dto.externalId
    };
  }
}
