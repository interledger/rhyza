export type IPalFxRateDto = {
  id: string;
  sourceAssetCode: string;
  destinationAssetCode: string;
  rateType: 'IntraAseRate' | 'PeerRate';
  acquisitionMethod: 'PulledFromAse' | 'PushedByAse';
  peerId: string | null; // null for InternalRates
  rate: number;
  fetchedAt: number | null; // null for set directly from ASe
  expiresAt: number | null;
};
