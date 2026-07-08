// for returned wallet address objects
export interface IPalClientWalletAddress {
  domain: string | null;
  pathName: string;
  publicName: string;
  assetCode: string;
  assetScale: number;
  isActive: boolean;
}

/**
 * This object includes the internal wallet address id,
 * should be used internally only
 */
export interface IGetWalletAddressResponse {
  id: string;
  publicName: string;
  assetCode: string;
  assetScale: number;
  isActive: boolean;
}

export type IGetPeerFxRateFromSourceAsset = {
  peerId: string;
  sourceAssetCode: string;
};

export type IGetPeerFxRateToDestinationAsset = {
  peerId: string;
  destinationAssetCode: string;
};

export type IGetIntraAseFxRate = {
  sourceAssetCode: string;
  destinationAssetCode: string;
};

/**
 * Local error types
 */
export class PalClientUnknownError extends Error {}

// ledger errors
export class PalClientLedgerUnknownError extends Error {}
export class PalClientLedgerNotFoundError extends Error {}
export class PalClientLedgerAlreadyExistsError extends Error {}
export class PalClientLedgerAccountAlreadyExistsError extends Error {}
export class PalClientLedgerAccountCreationFailedError extends Error {}

// peer errors
export class PalClientPeerAlreadyExistsError extends Error {}
export class PalClientPeerNotFoundError extends Error {}
