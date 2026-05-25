/* eslint-disable @typescript-eslint/no-explicit-any */

import pino from 'pino';
import { ILogger, ILoggerParams } from 'common-types-lib';

export class PinoLogger implements ILogger {
  private _logger: pino.Logger<never, boolean>;

  constructor(options?: { service?: string }) {
    this._logger = pino({
      level: process.env['LOG_LEVEL'] || 'debug',
      base: options?.service ? { service: options.service } : null
    });
  }

  private static _fromInstance(
    instance: pino.Logger<never, boolean>
  ): PinoLogger {
    const wrapper = new PinoLogger();
    wrapper._logger = instance;
    return wrapper;
  }

  child(bindings: Record<string, unknown>): PinoLogger {
    return PinoLogger._fromInstance(
      this._logger.child(bindings) as pino.Logger<never, boolean>
    );
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
