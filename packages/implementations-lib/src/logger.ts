/* eslint-disable @typescript-eslint/no-explicit-any */

import pino, { LoggerOptions } from 'pino';
import { ILogger, ILoggerParams } from 'common-types-lib';
import * as os from "node:os";

export class PinoLogger implements ILogger {
  private _logger: pino.Logger;

  constructor(bcName?:string, app?:{name:string, version:string}, instanceId?:string) {
    const options: LoggerOptions = {
      level: process.env['LOG_LEVEL'] || 'debug',
      base: {pid: process.pid, hostname: os.hostname()}
    }

    if(bcName){
      (options.base as any).bcName = bcName;
    }
    if(app){
      (options.base as any).appName = app.name;
      (options.base as any).appVersion = app.version;
    }
    if(instanceId){
      (options.base as any).instanceId = instanceId;
    }

    this._logger = pino(options);
  }

  child(componentName:string): ILogger {
    const wrapper = new PinoLogger();
    wrapper._logger = this._logger.child({component: componentName});
    return wrapper;
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
