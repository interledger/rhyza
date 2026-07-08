import { IPalFxRateDto } from 'pal-public-types-lib';

export class FxRate {
  private _id: string; // asset pair: source/destination asset codes and type
  private _rateType: 'IntraAseRate' | 'PeerRate';
  private _peerId: string | null; // null for local rates
  private _sourceAssetCode: string;
  private _destinationAssetCode: string;
  private _rate: number;

  private _acquisitionMethod: 'PulledFromAse' | 'PushedByAse';

  private _fetchedAt: number | null; // null for set directly from ASe
  private _expiresAt: number | null;

  constructor(
    sourceAssetCode: string,
    destinationAssetCode: string,
    rateType: 'IntraAseRate' | 'PeerRate',
    acquisitionMethod: 'PulledFromAse' | 'PushedByAse',
    peerId: string | null,
    rate: number,
    fetchedAt?: number | null,
    expiresAt?: number | null
  ) {
    this._rateType = rateType;
    this._peerId = peerId;
    this._sourceAssetCode = sourceAssetCode;
    this._destinationAssetCode = destinationAssetCode;
    this._rate = rate;
    this._acquisitionMethod = acquisitionMethod;
    this._fetchedAt = fetchedAt || null;
    this._expiresAt = expiresAt || null;

    this._id = FxRate.getRateId(
      this._sourceAssetCode,
      this._destinationAssetCode,
      this._rateType,
      this._peerId
    );
  }

  get id(): string {
    return this._id;
  }
  get rate(): number {
    return this._rate;
  }
  get sourceAssetCode(): string {
    return this._sourceAssetCode;
  }
  get destinationAssetCode(): string {
    return this._destinationAssetCode;
  }
  get rateType(): 'IntraAseRate' | 'PeerRate' {
    return this._rateType;
  }
  get peerId(): string | null {
    return this._peerId;
  }
  get acquisitionMethod(): 'PulledFromAse' | 'PushedByAse' {
    return this._acquisitionMethod;
  }
  get fetchedAt(): number | null {
    return this._fetchedAt;
  }

  static getRateId(
    sourceAssetCode: string,
    destinationAssetCode: string,
    rateType: 'IntraAseRate' | 'PeerRate',
    peerId: string | null
  ): string {
    let id = `${sourceAssetCode}/${destinationAssetCode}`;
    if (rateType === 'PeerRate') {
      id += `_peer:${peerId}`;
    }
    return id;
  }

  static fromDto(json: IPalFxRateDto): FxRate {
    const fxRate = new FxRate(
      json.sourceAssetCode,
      json.destinationAssetCode,
      json.rateType,
      json.acquisitionMethod,
      json.peerId,
      json.rate,
      json.fetchedAt,
      json.expiresAt
    );
    fxRate._id = json.id;
    return fxRate;
  }

  toDto(): IPalFxRateDto {
    return {
      id: this._id,
      rateType: this._rateType,
      peerId: this._peerId,
      sourceAssetCode: this._sourceAssetCode,
      destinationAssetCode: this._destinationAssetCode,
      rate: this._rate,
      acquisitionMethod: this._acquisitionMethod,
      fetchedAt: this._fetchedAt,
      expiresAt: this._expiresAt
    };
  }

  isExpired(): boolean {
    return this._expiresAt != null && Date.now() > this._expiresAt;
  }
}
