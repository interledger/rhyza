import { ILogger } from 'common-types-lib';
import {
  IPalAseFxService,
  IPalFxCacheExpiryService,
  IPalFxRepository
} from './interfaces';
import { FxRate } from './entity';

export class FxAggregate {
  private _logger: ILogger;
  private _ratesRepo: IPalFxRepository;
  private readonly _aseService: IPalAseFxService;
  private readonly _fxCacheExpiryService: IPalFxCacheExpiryService;

  constructor(
    ratesRepo: IPalFxRepository,
    aseService: IPalAseFxService,
    fxCacheExpiryService: IPalFxCacheExpiryService,
    logger: ILogger
  ) {
    this._ratesRepo = ratesRepo;
    this._aseService = aseService;
    this._fxCacheExpiryService = fxCacheExpiryService;
    this._logger = logger;
  }

  private async _fetchIntraAseRateAndStoreIt(
    sourceAssetCode: string,
    destinationAssetCode: string
  ): Promise<number | null> {
    let aseRate;
    try {
      aseRate = await this._aseService.getIntraAseFxRate(
        sourceAssetCode,
        destinationAssetCode
      );
    } catch (e) {
      this._logger.error(
        e,
        `Failed to get Intra ASE FX rate for ${sourceAssetCode}/${destinationAssetCode} asset pair`
      );
      return null;
    }

    if (!aseRate) {
      return null;
    }

    const newRate = new FxRate(
      sourceAssetCode,
      destinationAssetCode,
      'IntraAseRate',
      'PulledFromAse',
      null,
      aseRate.rate,
      Date.now(),
      aseRate.expiresAt
    );
    await this._ratesRepo.store(newRate.toDto());

    // set expiration timer
    await this._fxCacheExpiryService.setExpiry(newRate.id, aseRate.expiresAt);

    return aseRate.rate;
  }

  private async _fetchPeerRateAndStoreIt(
    peerId: string,
    sourceAssetCode: string,
    destinationAssetCode: string
  ): Promise<number | null> {
    let aseRate;
    try {
      aseRate = await this._aseService.getPeerFxFromAse(
        sourceAssetCode,
        destinationAssetCode,
        peerId
      );
    } catch (e) {
      this._logger.error(
        e,
        `Failed to get Peer ASE FX rate for peerId: ${peerId} and ${sourceAssetCode}/${destinationAssetCode} asset pair`
      );
      return null;
    }

    if (!aseRate) {
      return null;
    }

    const newRate = new FxRate(
      sourceAssetCode,
      destinationAssetCode,
      'PeerRate',
      'PulledFromAse',
      peerId,
      aseRate.rate,
      Date.now(),
      aseRate.expiresAt
    );
    await this._ratesRepo.store(newRate.toDto());

    // set expiration timer
    await this._fxCacheExpiryService.setExpiry(newRate.id, aseRate.expiresAt);

    return aseRate.rate;
  }

  async getIntraAseFxRate(
    sourceAssetCode: string,
    destinationAsset: string
  ): Promise<number | null> {
    const rateId = FxRate.getRateId(
      sourceAssetCode,
      destinationAsset,
      'IntraAseRate',
      null
    );
    const existingRateDto = await this._ratesRepo.fetch([rateId]);
    const existingRate = existingRateDto[0]
      ? FxRate.fromDto(existingRateDto[0])
      : null;

    if (existingRate && !existingRate.isExpired()) {
      return existingRate.rate;
    }

    return await this._fetchIntraAseRateAndStoreIt(
      sourceAssetCode,
      destinationAsset
    );
  }

  async setIntraAseFxRate(
    sourceAssetCode: string,
    destinationAsset: string,
    rate: number,
    expiresAt: number | null
  ): Promise<void> {
    const newRate = new FxRate(
      sourceAssetCode,
      destinationAsset,
      'IntraAseRate',
      'PushedByAse',
      null,
      rate,
      Date.now(),
      expiresAt
    );
    await this._ratesRepo.store(newRate.toDto());
    await this._fxCacheExpiryService.clearExpiry(newRate.id);
  }

  async getPeerFxRate(
    peerId: string,
    sourceAssetCode: string,
    destinationAsset: string
  ): Promise<number | null> {
    const rateId = FxRate.getRateId(
      sourceAssetCode,
      destinationAsset,
      'PeerRate',
      peerId
    );
    const existingRateDto = await this._ratesRepo.fetch([rateId]);
    const existingRate = existingRateDto[0]
      ? FxRate.fromDto(existingRateDto[0])
      : null;

    if (existingRate && !existingRate.isExpired()) {
      return existingRate.rate;
    }

    return await this._fetchPeerRateAndStoreIt(
      peerId,
      sourceAssetCode,
      destinationAsset
    );
  }

  async setPeerFxRate(
    sourceAssetCode: string,
    destinationAsset: string,
    peerId: string,
    rate: number,
    expiresAt: number | null
  ): Promise<void> {
    const newRate = new FxRate(
      sourceAssetCode,
      destinationAsset,
      'PeerRate',
      'PushedByAse',
      peerId,
      rate,
      Date.now(),
      expiresAt
    );
    await this._ratesRepo.store(newRate.toDto());
    await this._fxCacheExpiryService.clearExpiry(newRate.id);
  }

  async notifyExpiredFxRate(
    rateId: string,
    notificationTime: number
  ): Promise<void> {
    const existingRateDto = await this._ratesRepo.fetch([rateId]);
    const existingRate = existingRateDto[0]
      ? FxRate.fromDto(existingRateDto[0])
      : null;

    if (
      !existingRate ||
      existingRate.acquisitionMethod === 'PushedByAse' ||
      !existingRate.fetchedAt ||
      existingRate.fetchedAt >= notificationTime
    ) {
      // rate doesn't exist, was set by ASE, or was pre-fetched recently
      return;
    }

    if (existingRate.rateType === 'PeerRate') {
      // peer must exist on peer rate type
      await this._fetchPeerRateAndStoreIt(
        existingRate.peerId!,
        existingRate.sourceAssetCode,
        existingRate.destinationAssetCode
      );
    } else {
      await this._fetchIntraAseRateAndStoreIt(
        existingRate.sourceAssetCode,
        existingRate.destinationAssetCode
      );
    }
  }
}
