import { AssetNotFoundError, CannotCreateDuplicateAssetError } from './errors';
import { IPalAssetRepository } from './interfaces';
import { PalAsset } from './entity';
import { IPalAssetDto, AssetCreatedEvent } from 'pal-public-types-lib';
import { ILogger, IMessageProducer } from 'common-types-lib';

export class AssetAggregate {
  private readonly _logger: ILogger;
  private readonly _repo: IPalAssetRepository;
  private readonly _msgProducer: IMessageProducer;

  constructor(
    repo: IPalAssetRepository,
    msgProducer: IMessageProducer,
    logger: ILogger
  ) {
    this._logger = logger;
    this._repo = repo;
    this._msgProducer = msgProducer;
  }

  async createAsset(
    code: string,
    scale: number,
    liquidityLowThreshold: bigint | null = null,
    liquidityHighThreshold: bigint | null = null
  ): Promise<void> {
    const existing = await this._repo.fetch(code);

    if (existing) {
      throw new CannotCreateDuplicateAssetError(
        'Asset with code: ' + code + ' already exists'
      );
    }

    // TODO: validate inputs

    const newAsset = new PalAsset(
      code,
      scale,
      liquidityLowThreshold,
      liquidityHighThreshold
    );

    await this._repo.store(newAsset.toDto());

    // send domain event
    await this._msgProducer.send(
      new AssetCreatedEvent({
        code: code,
        scale: scale,
        liquidityLowThreshold: liquidityLowThreshold,
        liquidityHighThreshold: liquidityHighThreshold
      })
    );
  }

  async associateLedgerAccount(
    assetCode: string,
    ledgerAccountId: string
  ): Promise<void> {
    const found = await this._repo.fetch(assetCode);
    if (!found) {
      throw new AssetNotFoundError(
        `Asset with code ${assetCode} does not exist`
      );
    }
    const asset = PalAsset.fromDto(found);
    asset.associateLedgerAccount(ledgerAccountId);
    await this._repo.store(asset.toDto());
  }

  async getAsset(code: string): Promise<IPalAssetDto | null> {
    const found = await this._repo.fetch(code);

    if (!found) return null;

    return found;
  }
}
