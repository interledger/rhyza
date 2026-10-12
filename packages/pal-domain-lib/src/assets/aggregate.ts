import { AssetNotFoundError, CannotCreateDuplicateAssetError } from './errors';
import { IPalAssetRepository } from './interfaces';
import { PalAsset } from './entity';
import {
  AssetActivatedEvent,
  AssetCreatedEvent,
  AssetDomainEvent,
  IPalAssetDto
} from 'pal-public-types-lib';
import { ILogger } from 'common-types-lib';

export class AssetAggregate {
  private readonly _logger: ILogger;
  private readonly _repo: IPalAssetRepository;
  private readonly _uncommittedDomainEvents: AssetDomainEvent[];

  constructor(repo: IPalAssetRepository, logger: ILogger) {
    this._logger = logger.child(this.constructor.name);
    this._repo = repo;
    this._uncommittedDomainEvents = [];
  }

  get uncommittedDomainEvents(): AssetDomainEvent[] {
    return this._uncommittedDomainEvents;
  }

  clearUncommittedDomainEvents(): void {
    this._uncommittedDomainEvents.length = 0;
  }

  async createAsset(code: string, scale: number): Promise<void> {
    const existing = await this._repo.fetch([code]);

    if (existing.length > 0) {
      this._logger.warn(`Asset with code: ${code} already exists`);
      throw new CannotCreateDuplicateAssetError(
        'Asset with code: ' + code + ' already exists'
      );
    }

    // TODO: validate inputs

    const newAsset = new PalAsset(code, scale);

    await this._repo.store(newAsset.toDto());
    this._uncommittedDomainEvents.push(
      new AssetCreatedEvent({ assetCode: newAsset.code })
    );
    this._logger.debug(`Asset with code: ${code} created`);
  }

  async associateLedgerAccountAndActivate(
    assetCode: string,
    ledgerAccountId: string
  ): Promise<void> {
    const found = await this._repo.fetch([assetCode]);
    if (found.length === 0) {
      throw new AssetNotFoundError(
        `Asset with code ${assetCode} does not exist`
      );
    }
    const asset = PalAsset.fromDto(found[0]);
    asset.associateLedgerAccount(ledgerAccountId);
    await this._repo.store(asset.toDto());

    this._uncommittedDomainEvents.push(
      new AssetActivatedEvent({ assetCode: assetCode })
    );
  }

  async getAssets(codes?: string[]): Promise<IPalAssetDto[]> {
    return await this._repo.fetch(codes);
  }
}
