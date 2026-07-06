import { IPalPeerDto } from 'pal-public-types-lib';

export const PeerCommunicationMethods = {
  ILP: 'ILP'
} as const;
export type PeerCommunicationMethods = keyof typeof PeerCommunicationMethods;

export type IPalPeerCommunicationMethodDefinition = {
  type: 'ILP';
  staticAddress: string; // for matching
};

export type IPalPeerAccounts = {
  peerLiquidityAccId: string;
  peerClearingAccId: string;
  aseLiquidityAccId: string;
  aseClearingAccId: string;
  suspenseAccId: string;
};

export type IPalPeerFxRate = {
  sourceAssetCode: string;
  destinationAssetCode: string;
  rate: number;
  fetchedFromAse: boolean;
  fetchedAt: number | null; // null for set directly from ASe
  expiresAt: number | null;
};

export class PalPeer {
  private readonly _id: string;
  private readonly _name: string;
  private readonly _assetCode: string;
  private readonly _assetScale: number;
  private _active: boolean; // maybe a getter that checks if the peer is active using other characteristics
  private _communicationMethod: IPalPeerCommunicationMethodDefinition | null;
  private _ledgerAccounts: IPalPeerAccounts | null;
  private _fxRates: IPalPeerFxRate[];

  constructor(id: string, name: string, assetCode: string, assetScale: number) {
    this._id = id;
    this._assetCode = assetCode;
    this._assetScale = assetScale;
    this._name = name;

    this._active = false;
    this._communicationMethod = null;
    this._ledgerAccounts = null;
    this._fxRates = [];
  }

  setCommunicationMethodDefinition(
    commMethod: IPalPeerCommunicationMethodDefinition
  ) {
    this._communicationMethod = commMethod;
  }

  activate() {
    this._active = true;
  }

  deactivate() {
    this._active = false;
  }

  associateLedgerAccounts(
    peerLiquidityAccId: string,
    peerClearingAccId: string,
    aseLiquidityAccId: string,
    aseClearingAccId: string,
    suspenseAccId: string
  ): void {
    this._ledgerAccounts = {
      peerLiquidityAccId: peerLiquidityAccId,
      peerClearingAccId: peerClearingAccId,
      aseLiquidityAccId: aseLiquidityAccId,
      aseClearingAccId: aseClearingAccId,
      suspenseAccId: suspenseAccId
    };
  }

  static fromDto(json: IPalPeerDto): PalPeer {
    const peer = new PalPeer(
      json.id,
      json.name,
      json.assetCode,
      json.assetScale
    );
    if (json.communicationMethodDefinition) {
      peer._communicationMethod = json.communicationMethodDefinition;
    }
    if (json.ledgerAccounts) {
      peer._ledgerAccounts = json.ledgerAccounts;
    }
    peer._active = json.active;
    peer._fxRates = json.fxRates;
    return peer;
  }

  toDto(): IPalPeerDto {
    return {
      id: this._id,
      name: this._name,
      assetCode: this._assetCode,
      assetScale: this._assetScale,
      active: this._active,
      communicationMethodDefinition: this._communicationMethod,
      ledgerAccounts: this._ledgerAccounts,
      fxRates: this._fxRates
    };
  }

  // region getters and setters

  get id(): string {
    return this._id;
  }

  get name(): string {
    return this._name;
  }

  get assetCode(): string {
    return this._assetCode;
  }

  get assetScale(): number {
    return this._assetScale;
  }

  get active(): boolean {
    return this._active;
  }

  get communicationMethod(): IPalPeerCommunicationMethodDefinition | null {
    return this._communicationMethod;
  }

  get ledgerAccounts(): IPalPeerAccounts | null {
    return this._ledgerAccounts;
  }

  get fxRates(): IPalPeerFxRate[] {
    return this._fxRates;
  }

  // endregion getters and setters

  setFxRateFromSourceAsset(
    sourceAssetCode: string,
    expiresAt: number | null,
    rate: number,
    fetchedFromAse: boolean
  ): void {
    const existing = this.fxRates.find(
      (fx) => fx.sourceAssetCode === sourceAssetCode
    );

    if (existing) {
      existing.expiresAt = expiresAt;
      existing.fetchedAt = fetchedFromAse ? Date.now() : null;
      existing.fetchedFromAse = fetchedFromAse;
      existing.rate = rate;
    } else {
      this._fxRates.push({
        sourceAssetCode: sourceAssetCode,
        destinationAssetCode: this.assetCode,
        rate: rate,
        fetchedFromAse: fetchedFromAse,
        fetchedAt: fetchedFromAse ? Date.now() : null,
        expiresAt: expiresAt
      });
    }
  }

  setFxRateToDestinationAsset(
    destinationAsset: string,
    expiresAt: number | null,
    rate: number,
    fetchedFromAse: boolean
  ): void {
    const existing = this.fxRates.find(
      (fx) => fx.destinationAssetCode === destinationAsset
    );
    if (existing) {
      existing.expiresAt = expiresAt;
      existing.rate = rate;
      existing.fetchedAt = fetchedFromAse ? Date.now() : null;
      existing.fetchedFromAse = fetchedFromAse;
    } else {
      this._fxRates.push({
        sourceAssetCode: this.assetCode,
        destinationAssetCode: destinationAsset,
        rate: rate,
        fetchedFromAse: fetchedFromAse,
        fetchedAt: fetchedFromAse ? Date.now() : 0,
        expiresAt: expiresAt
      });
    }
  }

  getFxFromSourceAsset(sourceAssetCode: string): number | null {
    const fxRate = this._fxRates.find(
      (fx) =>
        fx.sourceAssetCode === sourceAssetCode &&
        (fx.expiresAt === null || fx.expiresAt > Date.now())
    );
    if (!fxRate) {
      return null;
    }

    return fxRate.rate;
  }

  getFxToDestinationAsset(destinationAssetCode: string): number | null {
    const fxRate = this._fxRates.find(
      (fx) =>
        fx.destinationAssetCode === destinationAssetCode &&
        (fx.expiresAt === null || fx.expiresAt > Date.now())
    );
    if (!fxRate) {
      return null;
    }

    return fxRate.rate;
  }

  getFxRate(
    sourceAssetCode: string,
    destinationAssetCode: string
  ): IPalPeerFxRate | null {
    const fxRate =
      this._fxRates.find(
        (fx) =>
          fx.sourceAssetCode === sourceAssetCode &&
          fx.destinationAssetCode === destinationAssetCode
      ) || null;

    return fxRate;
  }
}
