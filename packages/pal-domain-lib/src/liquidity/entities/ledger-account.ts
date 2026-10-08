import { ILedgerAccountDto } from 'pal-public-types-lib';

// enums
export const LedgerAccountTypes = {
  ASSET_LIQUIDITY_ACCOUNT: 'ASSET_LIQUIDITY_ACCOUNT',
  PEER_LIQUIDITY_ACCOUNT: 'PEER_LIQUIDITY_ACCOUNT',
  PEER_CLEARING_ACCOUNT: 'PEER_CLEARING_ACCOUNT',
  ASE_LIQUIDITY_ACCOUNT: 'ASE_LIQUIDITY_ACCOUNT',
  ASE_CLEARING_ACCOUNT: 'ASE_CLEARING_ACCOUNT',
  SUSPENSE_ACCOUNT: 'SUSPENSE_ACCOUNT'
} as const;
export type LedgerAccountTypes = keyof typeof LedgerAccountTypes;

export interface ILedgerAccount {
  id: string;
  type: LedgerAccountTypes;
  name: string;
  // for an asset account this is the asset id/code
  assetCode: string;
  assetDisplayScale: number;
  debitedAmount: bigint;
  creditedAmount: bigint;
  // for a peer account this is the peer id
  peerId?: string;
}

export class LedgerAccountDtoSerializer {
  static toDTO(ledgerAccount: ILedgerAccount): ILedgerAccountDto {
    return {
      id: ledgerAccount.id,
      type: ledgerAccount.type,
      name: ledgerAccount.name,
      assetCode: ledgerAccount.assetCode,
      assetDisplayScale: ledgerAccount.assetDisplayScale,
      debitedAmount: ledgerAccount.debitedAmount.toString(),
      creditedAmount: ledgerAccount.creditedAmount.toString(),
      peerId: ledgerAccount.peerId
    };
  }
  static fromDTO(dto: ILedgerAccountDto): ILedgerAccount {
    return {
      id: dto.id,
      type: dto.type,
      name: dto.name,
      assetCode: dto.assetCode,
      assetDisplayScale: dto.assetDisplayScale,
      debitedAmount: BigInt(dto.debitedAmount),
      creditedAmount: BigInt(dto.creditedAmount),
      peerId: dto.peerId
    };
  }
}
