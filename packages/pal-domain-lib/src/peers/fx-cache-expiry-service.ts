import { IPalPeerFxCacheExpiryService } from '../../src';
import { ILogger, IMessageProducer } from 'common-types-lib';
import { PeerFxCacheExpiredEvent } from 'pal-public-types-lib';

export class PeerFxCacheExpiryService implements IPalPeerFxCacheExpiryService {
  private _messageProducer: IMessageProducer;
  private _logger: ILogger;

  constructor(messagePub: IMessageProducer, logger: ILogger) {
    this._messageProducer = messagePub;
    this._logger = logger;
  }

  async setExpiry(
    peerId: string,
    sourceAssetCode: string,
    destinationAssetCode: string,
    expiresAt: number
  ): Promise<void> {
    if (Date.now() >= expiresAt) {
      return Promise.resolve();
    }

    const timoutMs = expiresAt - Date.now();

    setTimeout(async () => {
      this._logger.debug(
        `PeerFxCacheExpiryService: sending expired event for peer ${peerId} source ${sourceAssetCode} destination ${destinationAssetCode}`
      );

      await this._messageProducer.send(
        new PeerFxCacheExpiredEvent({
          peerId,
          sourceAssetCode,
          destinationAssetCode,
          expiresAt: Date.now()
        })
      );
    }, timoutMs);

    return Promise.resolve();
  }
}
