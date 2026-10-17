// for returned wallet address objects
export interface IPalClientWalletAddress {
  id: string;
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

export type IPalClientLiquidityRequest = {
  requestId: string;
  peerId: string;
  assetCode: string;
  amount: string;
  amountScale: number;
  externalId?: string;
};

export type IPalClientLiquidityResponse = {
  peerId: string;
  requestId: string;
  externalId?: string;

  isError: boolean;
  errorMessage?: string;
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

export class PalClientLedgerInsufficientFundsForWithdrawalError extends Error {}

// peer errors
export class PalClientPeerAlreadyExistsError extends Error {}
export class PalClientPeerNotFoundError extends Error {}
export class PalClientPeerAlreadyInactiveError extends Error {}

// wallet address key errors
export class PalClientWalletAddressNotFoundError extends Error {}
export class PalClientWalletAddressAlreadyInactiveError extends Error {}
export class PalClientWalletAddressAlreadyActiveError extends Error {}
export class PalClientWalletAddressKeyNotFoundError extends Error {}
export class PalClientWalletAddressKeyAlreadyRevokedError extends Error {}
export class PalClientDuplicateWalletAddressKeyError extends Error {}
export class PalClientInvalidWalletAddressJwkError extends Error {}
