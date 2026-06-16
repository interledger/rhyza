export interface IPalPeerDto {
  id: string;
  name: string;
  assetCode: string;
  assetScale: number;
  active: boolean;

  communicationMethodDefinition: null | {
    type: 'ILP';
    staticAddress: string;
  };

  ledgerAccounts: null | {
    peerLiquidityAccId: string;
    peerClearingAccId: string;
    aseLiquidityAccId: string;
    aseClearingAccId: string;
    suspenseAccId: string;
  };

  fxRates: {
    sourceAssetCode: string;
    destinationAssetCode: string;
    rate: number;
    fetchedFromAse: boolean;
    fetchedAt: number | null; // null for set directly from ASe;
    expiresAt: number | null;
  }[];
}
