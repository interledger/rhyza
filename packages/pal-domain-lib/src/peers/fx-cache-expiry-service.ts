import { IPalPeerFxCacheExpiryService } from '../../src';
import { ILogger, IMessageProducer } from 'common-types-lib';
import { PeerFxCacheExpiredEvent } from 'pal-public-types-lib';

// Let's reduce the TTL by 5 seconds to account for clock drift
// and ensure the cache is refreshed before it expires
const TTL_REDUCED_BY_MS = 5000;

export class PeerFxCacheExpiryService implements IPalPeerFxCacheExpiryService {
  private _messageProducer: IMessageProducer;
  private _logger: ILogger;
  private _activeTimeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor(messagePub: IMessageProducer, logger: ILogger) {
    this._messageProducer = messagePub;
    this._logger = logger;
  }

  destroy(): void {
    this._activeTimeouts.forEach((timeout) => clearTimeout(timeout));
    this._activeTimeouts.clear();
  }

  private _getActiveTimeoutKey(
    peerId: string,
    sourceAssetCode: string,
    destinationAssetCode: string
  ): string {
    return `${peerId}-${sourceAssetCode}-${destinationAssetCode}`;
  }

  async setExpiry(
    peerId: string,
    sourceAssetCode: string,
    destinationAssetCode: string,
    expiresAt: number
  ): Promise<void> {
    const timeoutMs = expiresAt - Date.now() - TTL_REDUCED_BY_MS;

    if (timeoutMs <= 0) {
      this._logger.warn(
        `PeerFxCacheExpiryService: cache for peer ${peerId} source ${sourceAssetCode} destination ${destinationAssetCode} should've already expired when setting expiry, skipping`
      );
      return Promise.resolve();
    }

    const timer = setTimeout(async () => {
      this._logger.debug(
        `PeerFxCacheExpiryService: sending expired event for peer ${peerId} source ${sourceAssetCode} destination ${destinationAssetCode}`
      );

      await this._messageProducer.send(
        new PeerFxCacheExpiredEvent({
          peerId,
          sourceAssetCode,
          destinationAssetCode
        })
      );
    }, timeoutMs);

    this._activeTimeouts.set(
      this._getActiveTimeoutKey(peerId, sourceAssetCode, destinationAssetCode),
      timer
    );

    return Promise.resolve();
  }
}
