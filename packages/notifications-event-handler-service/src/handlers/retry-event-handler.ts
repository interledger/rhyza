import { ILogger, IMessageProducer } from 'common-types-lib';
import {
  INotificationRepository,
  RetryNotificationTickCmd
} from 'notifications-domain-lib';

const RETRY_INTERVAL_MS = Number(process.env.RETRY_INTERVAL_MS || 10000);
const NOTIFICATION_BATCH_SIZE = Number(
  process.env.NOTIFICATION_BATCH_SIZE || 10
);

export class RetryEventHandler {
  private readonly _logger: ILogger;
  private readonly _msgProducer: IMessageProducer;
  private readonly _instanceId: string;
  private readonly _notificationRepository: INotificationRepository;
  private interval?: NodeJS.Timeout;

  constructor(
    msgProducer: IMessageProducer,
    notificationRepository: INotificationRepository,
    logger: ILogger,
    instanceId: string
  ) {
    this._msgProducer = msgProducer;
    this._notificationRepository = notificationRepository;
    this._logger = logger;
    this._instanceId = instanceId;
  }

  async start(): Promise<void> {
    this.interval = setInterval(async () => {
      try {
        const notificationIds =
          await this._notificationRepository.getPendingRetryNotificationIds(
            NOTIFICATION_BATCH_SIZE
          );
        if (notificationIds.length === 0) {
          return;
        }
        const commands = notificationIds.map(
          (id) => new RetryNotificationTickCmd({ id }, this._instanceId)
        );
        await this._msgProducer.send(commands);
      } catch (err) {
        this._logger.error(`${this.constructor.name} error: ${err}`);
      }
    }, RETRY_INTERVAL_MS);
    this._logger.info(`${this.constructor.name} initialized`);
  }

  async stop(): Promise<void> {
    clearInterval(this.interval);
    this._logger.info(`${this.constructor.name} stopped`);
  }
}
