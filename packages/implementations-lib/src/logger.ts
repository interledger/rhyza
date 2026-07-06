/* eslint-disable @typescript-eslint/no-explicit-any */

import pino, { LoggerOptions } from 'pino';
import { ILogger, ILoggerParams } from 'common-types-lib';
import * as os from 'node:os';

export class PinoLogger implements ILogger {
  private _logger: pino.Logger;

  constructor(options?: {
    bcName?: string;
    appName?: string;
    appVersion?: string;
    instanceId?: string;
  }) {
    const loggerOptions: LoggerOptions = {
      level: process.env['LOG_LEVEL'] || 'debug',
      base: { pid: process.pid, hostname: os.hostname() }
    };

    if (options?.bcName) {
      (loggerOptions.base as any).bcName = options.bcName;
    }
    if (options?.appName) {
      (loggerOptions.base as any).appName = options.appName;
    }
    if (options?.appVersion) {
      (loggerOptions.base as any).appVersion = options.appVersion;
    }
    if (options?.instanceId) {
      (loggerOptions.base as any).instanceId = options.instanceId;
    }

    this._logger = pino(loggerOptions);
  }

  static isPinoLogger(logger: ILogger): logger is PinoLogger {
    return logger instanceof PinoLogger;
  }

  private _log(fn: ILoggerParams, ...args: any[]): void {
    if (
      args.length > 0 &&
      (typeof args[0] === 'string' ||
        args[0] instanceof Error ||
        args[0] instanceof Object)
    ) {
      fn(args[0], args.slice(1) || undefined);
    } else {
      fn(args);
    }
  }

  get internalLogger(): pino.Logger {
    return this._logger;
  }

  child(componentName: string): ILogger {
    const wrapper = new PinoLogger();
    wrapper._logger = this._logger.child({ component: componentName });
    return wrapper;
  }
  setLogLevel(logLevel: any): void {
    this._logger.level = logLevel;
  }

  fatal(...args: any[]): void {
    this._log(this._logger.fatal.bind(this._logger), ...args);
  }
  error(...args: any[]): void {
    this._log(this._logger.error.bind(this._logger), ...args);
  }
  warn(...args: any[]): void {
    this._log(this._logger.warn.bind(this._logger), ...args);
  }
  info(...args: any[]): void {
    this._log(this._logger.info.bind(this._logger), ...args);
  }
  debug(...args: any[]): void {
    this._log(this._logger.debug.bind(this._logger), ...args);
  }
  trace(...args: any[]): void {
    this._log(this._logger.trace.bind(this._logger), ...args);
  }

  isTraceEnabled(): boolean {
    return this._logger.levelVal >= pino.levels.values.trace;
  }
  isDebugEnabled(): boolean {
    return this._logger.levelVal >= pino.levels.values.debug;
  }
  isInfoEnabled(): boolean {
    return this._logger.levelVal >= pino.levels.values.info;
  }
  isWarnEnabled(): boolean {
    return this._logger.levelVal >= pino.levels.values.warn;
  }
  isErrorEnabled(): boolean {
    return this._logger.levelVal >= pino.levels.values.error;
  }
  isFatalEnabled(): boolean {
    return this._logger.levelVal >= pino.levels.values.fatal;
  }
}
