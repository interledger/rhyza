import { sendUnaryData, ServerUnaryCall } from '@grpc/grpc-js';
import { Status } from '@grpc/grpc-js/build/src/constants';
import * as grpc from '@grpc/grpc-js';
import { PendingResponse } from '../types';
import { ILogger } from 'common-types-lib';

export class PendingResponseRegistry {
  private readonly _logger: ILogger;
  private readonly _responseTimeoutMs: number;
  private readonly _responseMap: Map<string, PendingResponse>;

  constructor(responseTimeoutMs: number, logger: ILogger) {
    this._logger = logger.child(this.constructor.name);
    this._responseTimeoutMs = responseTimeoutMs;
    this._responseMap = new Map();
  }

  store(
    requestId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call: ServerUnaryCall<any, any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: sendUnaryData<any>
  ): void {
    const deadline = call.getDeadline();
    let timeoutMs: number;

    if (deadline instanceof Date) {
      timeoutMs = deadline.getTime() - Date.now();
    } else if (typeof deadline === 'number' && deadline !== Infinity) {
      timeoutMs = deadline - Date.now();
    } else {
      timeoutMs = this._responseTimeoutMs;
    }

    // Ensure at least a minimal timeout
    timeoutMs = Math.max(timeoutMs, 0);

    const timer = setTimeout(() => {
      const pending = this._responseMap.get(requestId);
      if (pending) {
        this._responseMap.delete(requestId);
        pending.callback({
          code: grpc.status.DEADLINE_EXCEEDED,
          message: 'Response timeout exceeded'
        });
        this._logger.warn(
          `Response timeout exceeded for requestId: ${requestId} after ${timeoutMs}ms.`
        );
      }
    }, timeoutMs);

    this._responseMap.set(requestId, {
      requestId: requestId,
      callback: callback,
      timer: timer
    });
  }

  resolve(
    pending: PendingResponse,
    error: { code: Status; message: string } | null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response?: any
  ): void {
    clearTimeout(pending.timer);
    this._responseMap.delete(pending.requestId);

    if (error) {
      pending.callback({
        code: error.code,
        message: error.message
      });
      return;
    }

    if (!response) {
      throw new Error('Response is required for successful response');
    }
    pending.callback(null, response);
  }

  get(requestId: string): PendingResponse | undefined {
    return this._responseMap.get(requestId);
  }
}
