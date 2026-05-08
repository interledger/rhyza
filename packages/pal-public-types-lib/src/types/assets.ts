export interface IPalAssetDto {
  code: string;
  scale: number;
  liquidityLowThreshold: bigint | null;
  liquidityHighThreshold: bigint | null;
  ledgerAccountId: string | null;
}
