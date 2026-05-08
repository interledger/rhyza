export interface IPalPeerDto {
  id: string;
  name: string;
  assetCode: string;
  assetScale: number;

  ledgerAccountId: string | null;

  active: boolean;
  communicationMethod: null | {
    type: 'ILP';
    staticAddress: string;
  };
}
