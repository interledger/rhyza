import { ILogger } from 'common-types-lib';
import {
  MethodDefinition,
  sendUnaryData,
  ServerUnaryCall
} from '@grpc/grpc-js';
import { UnaryResponse } from '../types';

export type RequestHandlerFunc = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: ServerUnaryCall<any, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callback: sendUnaryData<any | undefined>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) => Promise<void | UnaryResponse<any>>;

type RequestHandlerItem = {
  requestPath: string;
  func: RequestHandlerFunc;
  async: boolean;
};

export class RequestHandlerRegistry {
  private readonly _logger: ILogger;
  private readonly _handlers: RequestHandlerItem[];

  constructor(logger: ILogger) {
    this._logger = logger;
    this._handlers = [];
  }

  get(
    requestPath: string
  ): { func: RequestHandlerFunc; async: boolean } | null {
    const found: RequestHandlerItem | undefined = this._handlers.find(
      (h) => h.requestPath === requestPath
    );
    if (!found) {
      this._logger.warn(
        `No request handler found for request with path: ${requestPath}`
      );
      return null;
    }

    return {
      func: found.func,
      async: found.async
    };
  }

  register(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    methodDefinition: MethodDefinition<any, any>,
    func: RequestHandlerFunc,
    async: boolean = false
  ) {
    const requestPath = methodDefinition.path;
    if (!requestPath) {
      throw new Error(
        'Invalid methodDefinition in RequestHandlerRegistry.register()'
      );
    }

    const exist = this._handlers.find(
      (item) => item.requestPath === requestPath
    );

    if (exist) {
      throw new Error(
        `Request with class name ${requestPath} already registered`
      );
    }

    this._handlers.push({
      requestPath: requestPath,
      func: func,
      async: async
    });
  }
}
