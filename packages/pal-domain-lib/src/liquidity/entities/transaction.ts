import { ILedgerTransactionDto } from 'pal-public-types-lib';

export interface ILedgerTransaction {
  id: string;
  originatingCommandName: string;
  debitedAccountId: string;
  creditedAccountId: string;
  amount: bigint;
  amountScale: number;
  timestamp: number;
  externalId?: string; // external liquidity id
  isReservation: boolean;
  voidsReservation: boolean;
  peerId: string;
  transferId?: string; //transferId for non-liquidity transaction
}

export class LedgerTransactionDtoSerializer {
  static toDTO(transaction: ILedgerTransaction): ILedgerTransactionDto {
    return {
      id: transaction.id,
      originatingCommandName: transaction.originatingCommandName,
      debitedAccountId: transaction.debitedAccountId,
      creditedAccountId: transaction.creditedAccountId,
      amount: transaction.amount.toString(),
      amountScale: transaction.amountScale,
      timestamp: transaction.timestamp,
      peerId: transaction.peerId,
      externalId: transaction.externalId,
      transferId: transaction.transferId,
      isReservation: transaction.isReservation,
      voidsReservation: transaction.voidsReservation
    };
  }
  static fromDTO(dto: ILedgerTransactionDto): ILedgerTransaction {
    return {
      id: dto.id,
      originatingCommandName: dto.originatingCommandName,
      debitedAccountId: dto.debitedAccountId,
      creditedAccountId: dto.creditedAccountId,
      amount: BigInt(dto.amount),
      amountScale: dto.amountScale,
      timestamp: dto.timestamp,
      peerId: dto.peerId,
      externalId: dto.externalId,
      transferId: dto.transferId,
      isReservation: dto.isReservation,
      voidsReservation: dto.voidsReservation
    };
  }
}
