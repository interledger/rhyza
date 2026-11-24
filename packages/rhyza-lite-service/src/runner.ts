import type { ILogger } from 'common-types-lib';

export interface LiteServiceEntry {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export class LiteRunner {
  private readonly started: LiteServiceEntry[] = [];
  private stopping = false;
  private stopPromise: Promise<void> | undefined;
  private startPromise: Promise<void> | undefined;
  private failed = false;

  constructor(
    private readonly entries: readonly LiteServiceEntry[],
    private readonly logger: ILogger
  ) {}

  /** True once a service start failed outside a requested stop. */
  get startFailed(): boolean {
    return this.failed;
  }

  async start(): Promise<void> {
    this.startPromise = this.runStart();
    await this.startPromise;
  }

  private async runStart(): Promise<void> {
    for (const entry of this.entries) {
      if (this.stopping) return;
      this.logger.info(`Starting ${entry.name}...`);
      try {
        await entry.start();
      } catch (err) {
        if (this.stopping) {
          // stop() is already tearing down; don't surface a late failure.
          this.logger.error({ err }, `${entry.name} failed to start while stopping`);
          return;
        }
        this.logger.error({ err }, `${entry.name} failed to start`);
        this.failed = true;
        this.stopping = true;
        this.stopPromise = this.drain();
        await this.stopPromise;
        throw err;
      }
      this.started.push(entry);
      this.logger.info(`${entry.name} started`);
    }
  }

  stop(): Promise<void> {
    if (!this.stopPromise) {
      this.stopping = true;
      this.stopPromise = this.runStop();
    }
    return this.stopPromise;
  }

  private async runStop(): Promise<void> {
    // Let an in-flight start settle so everything it started gets stopped.
    if (this.startPromise) {
      await this.startPromise.catch(() => undefined);
    }
    await this.drain();
  }

  private async drain(): Promise<void> {
    while (this.started.length > 0) {
      const entry = this.started.pop()!;
      try {
        await entry.stop();
        this.logger.info(`${entry.name} stopped`);
      } catch (err) {
        this.logger.error({ err }, `${entry.name} failed to stop`);
      }
    }
  }
}
