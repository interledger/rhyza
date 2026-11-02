import { ILogger, IMessageProducer } from 'common-types-lib';
import { CheckExpirationEvent } from 'payments-public-types-lib';

const CHECK_EXPIRED_INTERVAL_MS = Number(
  process.env.CHECK_EXPIRED_INTERVAL_MS || 5000
);
export class CheckExpirationEventHandler {
  private _msgProducer: IMessageProducer;
  private _logger: ILogger;
  private _instanceId: string;
  private interval?: NodeJS.Timeout;

  constructor(
    msgProducer: IMessageProducer,
    logger: ILogger,
    instanceId: string
  ) {
    this._msgProducer = msgProducer;
    this._logger = logger;
    this._instanceId = instanceId;
  }

  async start(): Promise<void> {
    this.interval = setInterval(() => {
      this._msgProducer
        .send(new CheckExpirationEvent(this._instanceId))
        .catch((err) => {
          this._logger.error(`${this.constructor.name} error: ${err}`);
        });
    }, CHECK_EXPIRED_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    clearInterval(this.interval);
    this._logger.info(`${this.constructor.name} stopped`);
  }
}
