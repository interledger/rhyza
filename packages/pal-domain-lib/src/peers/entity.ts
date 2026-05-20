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

export class PalPeer {
  private readonly _id: string;
  private readonly _name: string;
  private readonly _assetCode: string;
  private readonly _assetScale: number;
  private _active: boolean; // maybe a getter that checks if the peer is active using other characteristics
  private _communicationMethod: IPalPeerCommunicationMethodDefinition | null;
  private _ledgerAccounts: IPalPeerAccounts | null;

  constructor(id: string, name: string, assetCode: string, assetScale: number) {
    this._id = id;
    this._assetCode = assetCode;
    this._assetScale = assetScale;
    this._name = name;

    this._active = false;
    this._communicationMethod = null;
    this._ledgerAccounts = null;
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
      ledgerAccounts: this._ledgerAccounts
    };
  }

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
}
