/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ILoggerParams {
  (obj: unknown, msg?: string, ...args: any[]): void;
  (msg: string, ...args: any[]): void;
}

export interface ILogger {
  fatal: ILoggerParams;
  error: ILoggerParams;
  warn: ILoggerParams;
  info: ILoggerParams;
  debug: ILoggerParams;
  trace: ILoggerParams;

  child(componentName: string): ILogger;

  setLogLevel: (logLevel: any) => void;
}

// default implementation of ILogger which uses the console (no ext dependencies)
export class ConsoleLogger implements ILogger {
  fatal(...args: any[]): void {
    console.error(args);
  }
  error(...args: any[]): void {
    console.error(args);
  }
  warn(...args: any[]): void {
    console.warn(args);
  }
  info(...args: any[]): void {
    console.info(args);
  }
  debug(...args: any[]): void {
    console.debug(args);
  }
  trace(...args: any[]): void {
    console.trace(args);
  }

  isTraceEnabled(): boolean {
    return true;
  }
  isDebugEnabled(): boolean {
    return true;
  }
  isInfoEnabled(): boolean {
    return true;
  }
  isWarnEnabled(): boolean {
    return true;
  }
  isErrorEnabled(): boolean {
    return true;
  }
  isFatalEnabled(): boolean {
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setLogLevel(logLevel: any): void {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  child(componentName: string): ILogger {
    return this;
  }
}
