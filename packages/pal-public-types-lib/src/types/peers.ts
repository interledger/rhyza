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
}
