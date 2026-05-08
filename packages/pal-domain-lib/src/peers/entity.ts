import { IPalPeerDto } from 'pal-public-types-lib';

export type IPalPeerCommunicationMethod = {
  type: 'ILP';
  staticAddress: string; // for matching
};

export class PalPeer {
  private readonly _id: string;
  private readonly _name: string;
  private readonly _assetCode: string;
  private readonly _assetScale: number;
  private _active: boolean; // maybe a getter that checks if the peer is active using other characteristics
  private _communicationMethod: IPalPeerCommunicationMethod | null;
  private _ledgerAccountId: string | null;

  constructor(id: string, name: string, assetCode: string, assetScale: number) {
    this._id = id;
    this._assetCode = assetCode;
    this._assetScale = assetScale;
    this._name = name;

    this._active = false;
    this._communicationMethod = null;
    this._ledgerAccountId = null;
  }

  setCommunicationMethod(commMethod: IPalPeerCommunicationMethod) {
    this._communicationMethod = commMethod;
  }

  activate() {
    this._active = true;
  }

  deactivate() {
    this._active = false;
  }

  associateLedgerAccount(ledgerAccountId: string): void {
    this._ledgerAccountId = ledgerAccountId;
  }

  static fromDto(json: IPalPeerDto): PalPeer {
    const peer = new PalPeer(
      json.id,
      json.name,
      json.assetCode,
      json.assetScale
    );
    if (json.communicationMethod) {
      peer._communicationMethod = json.communicationMethod;
    }
    if (json.ledgerAccountId) {
      peer._ledgerAccountId = json.ledgerAccountId;
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
      communicationMethod: this._communicationMethod,
      ledgerAccountId: this._ledgerAccountId
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

  get communicationMethod(): IPalPeerCommunicationMethod | null {
    return this._communicationMethod;
  }

  get ledgerAccountId(): string | null {
    return this._ledgerAccountId;
  }
}
