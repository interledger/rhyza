export interface ILedgerDto {
  id: string;
  version: string;
  assetScale: number;
}

export interface ILedgerAccountDto {
  id: string;
  name: string;
  assetCode: string;
  assetDisplayScale: number;
  debitedAmount: string;
  creditedAmount: string;
  externalId?: string;
}

export interface ILedgerTransactionDto {
  id: string;
  debitedAccountId: string;
  creditedAccountId: string;
  amount: string;
  amountScale: number;
  timestamp: number;
  externalId?: string;
}
