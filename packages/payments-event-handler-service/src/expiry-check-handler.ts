import crypto from 'crypto';
import {
  ILogger,
  IMessage,
  IMessageConsumer,
  IMessageProducer,
  TimerEventTopics
} from 'common-types-lib';
import {
  ExpirePaymentCmd,
  ExpirePaymentIntentCmd,
  IPaymentIntentRepository,
  PaymentExpiryCheckTimerEvent
} from 'payments-domain-lib';

export type ExpiryCheckConfig = {
  /** How often each instance publishes a tick. */
  tickIntervalMs: number;
  /** Ticks closer together than this run a single check. */
  minCheckIntervalMs: number;
  /** Most commands each query produces per check; the rest wait a tick. */
  limit: number;
};

type ExpiryRepo = Pick<
  IPaymentIntentRepository,
  'fetchExpiredPaymentIntentIds' | 'fetchExpiredRemotePayments'
>;

// One query and the expire command it produces. Receiving-side expiry is
// meant to be another entry here.
type ExpiryCheck = (
  now: Date,
  limit: number,
  requestId: string
) => Promise<IMessage[]>;

/**
 * Finds what is past its expiry and sends the commands that expire it.
 *
 * Every instance publishes a tick on an interval. The ticks share one key,
 * so they land on one partition and only the instance that consumes it runs
 * the check, at most once per `minCheckIntervalMs`. The aggregate decides
 * whether each command actually expires anything, so a command sent twice
 * (the next check runs before the first is handled) is harmless.
 */
export class ExpiryCheckHandler {
  private _timer: NodeJS.Timeout | null = null;
  private _lastCheckAt = 0;
  private readonly _checks: ExpiryCheck[];

  constructor(
    private _msgConsumer: IMessageConsumer,
    private _msgProducer: IMessageProducer,
    private _repo: ExpiryRepo,
    private _logger: ILogger,
    private _config: ExpiryCheckConfig
  ) {
    this._checks = [
      async (now, limit, requestId) =>
        (await this._repo.fetchExpiredPaymentIntentIds(now, limit)).map(
          (paymentIntentId) =>
            new ExpirePaymentIntentCmd({ paymentIntentId }, requestId)
        ),
      async (now, limit, requestId) =>
        (await this._repo.fetchExpiredRemotePayments(now, limit)).map(
          (payment) => new ExpirePaymentCmd(payment, requestId)
        )
    ];
  }

  async start(): Promise<void> {
    this._msgConsumer.setTopics([TimerEventTopics.PaymentTimerEvents]);
    this._msgConsumer.setBatchCallbackFn(this.handleMessages.bind(this));
    await this._msgConsumer.connect();
    await this._msgConsumer.startAndWaitForRebalance();

    this._timer = setInterval(() => {
      this._msgProducer
        .send(new PaymentExpiryCheckTimerEvent())
        .catch((err: Error) =>
          this._logger.error(`Failed to publish expiry tick: ${err.message}`)
        );
    }, this._config.tickIntervalMs);

    this._logger.info(
      `${this.constructor.name} started - tick interval ${this._config.tickIntervalMs}ms`
    );
  }

  async stop(): Promise<void> {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    await this._msgConsumer.stop();
    await this._msgConsumer.disconnect(true);
  }

  async handleMessages(messages: IMessage[]): Promise<void> {
    // A batch holds every instance's ticks since the last one, so it runs at
    // most one check.
    const hasTick = messages.some(
      (message) => message.msgName === PaymentExpiryCheckTimerEvent.name
    );
    if (!hasTick) return;

    const now = Date.now();
    if (now - this._lastCheckAt < this._config.minCheckIntervalMs) return;
    this._lastCheckAt = now;

    await this.checkExpirations(new Date(now));
  }

  async checkExpirations(now: Date): Promise<void> {
    const requestId = crypto.randomUUID();
    const commands: IMessage[] = [];
    for (const check of this._checks) {
      try {
        commands.push(...(await check(now, this._config.limit, requestId)));
      } catch (err) {
        // The next tick retries; one failing query should not block the rest.
        this._logger.error(`Expiry check failed: ${(err as Error).message}`);
      }
    }
    if (commands.length === 0) return;

    this._logger.debug(`Expiry check sending ${commands.length} command(s)`);
    await this._msgProducer.send(commands);
  }
}
