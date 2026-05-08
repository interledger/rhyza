import { ILedgerTransactionDto } from 'pal-public-types-lib';

export interface ILedgerTransaction {
  id: string;
  debitedAccountId: string;
  creditedAccountId: string;
  amount: bigint;
  amountScale: number;
  timestamp: number;
  externalId?: string;
}

export class LedgerTransactionDtoSerializer {
  static toDTO(transaction: ILedgerTransaction): ILedgerTransactionDto {
    return {
      id: transaction.id,
      debitedAccountId: transaction.debitedAccountId,
      creditedAccountId: transaction.creditedAccountId,
      amount: transaction.amount.toString(),
      amountScale: transaction.amountScale,
      timestamp: transaction.timestamp,
      externalId: transaction.externalId
    };
  }
  static fromDTO(dto: ILedgerTransactionDto): ILedgerTransaction {
    return {
      id: dto.id,
      debitedAccountId: dto.debitedAccountId,
      creditedAccountId: dto.creditedAccountId,
      amount: BigInt(dto.amount),
      amountScale: dto.amountScale,
      timestamp: dto.timestamp,
      externalId: dto.externalId
    };
  }
}
