import { FxRateCacheExpiredEvent } from 'pal-public-types-lib';
import { IPalFxCacheExpiryService } from './interfaces';
import { ILogger, IMessageProducer } from 'common-types-lib';

// Let's reduce the TTL by 5 seconds to account for clock drift
// and ensure the cache is refreshed before it expires
const TTL_REDUCED_BY_MS = 5000;

export class FxCacheExpiryService implements IPalFxCacheExpiryService {
  private _messageProducer: IMessageProducer;
  private _logger: ILogger;
  private _activeTimeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor(messagePub: IMessageProducer, logger: ILogger) {
    this._messageProducer = messagePub;
    this._logger = logger.child(this.constructor.name);
  }

  destroy(): void {
    this._activeTimeouts.forEach((timeout) => clearTimeout(timeout));
    this._activeTimeouts.clear();
  }

  async setExpiry(rateId: string, expiresAt: number): Promise<void> {
    const timeoutMs = expiresAt - Date.now() - TTL_REDUCED_BY_MS;
    if (timeoutMs <= 0) {
      this._logger.warn(
        `FxCacheExpiryService: cache for rate ${rateId} should've already expired when setting expiry, skipping`
      );
      return Promise.resolve();
    }

    const existing = this._activeTimeouts.get(rateId);
    if (existing) {
      clearTimeout(existing);
      this._activeTimeouts.delete(rateId);
    }

    const timer = setTimeout(async () => {
      this._logger.debug(
        `FxCacheExpiryService: sending expired event for rate ${rateId}`
      );

      this._activeTimeouts.delete(rateId);

      await this._messageProducer.send(
        new FxRateCacheExpiredEvent({
          id: rateId
        })
      );
    }, timeoutMs);

    this._activeTimeouts.set(rateId, timer);

    return Promise.resolve();
  }

  async clearExpiry(rateId: string): Promise<void> {
    const existing = this._activeTimeouts.get(rateId);
    if (!existing) return;

    clearTimeout(existing);
    this._activeTimeouts.delete(rateId);
  }
}
