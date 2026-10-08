import { Metadata, ServiceError, status } from '@grpc/grpc-js';
import { IClientErrorResponse } from './types';

export function createServiceError(
  code: status,
  message: string,
  name = 'AuthServiceError'
): ServiceError {
  return {
    code,
    message,
    details: message,
    name,
    metadata: new Metadata()
  };
}

export function isGrpcServiceError(err: unknown): err is ServiceError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as ServiceError).code === 'number'
  );
}

export function toClientApiErrorResponse(err: unknown): IClientErrorResponse {
  if (isGrpcServiceError(err)) {
    return {
      error: {
        code: status[err.code] ?? 'INTERNAL',
        description: err.details || err.message
      }
    };
  }

  const fallbackError = err as Error;
  return {
    error: {
      code: fallbackError.name || 'Error',
      description: fallbackError.message
    }
  };
}

export function httpStatusFromGrpcError(err: unknown): number {
  if (!isGrpcServiceError(err)) {
    return 500;
  }

  switch (err.code) {
    case status.INVALID_ARGUMENT:
      return 400;
    case status.NOT_FOUND:
      return 404;
    case status.ALREADY_EXISTS:
      return 409;
    case status.PERMISSION_DENIED:
      return 403;
    case status.FAILED_PRECONDITION:
      return 409;
    case status.ABORTED:
      return 409;
    case status.UNAVAILABLE:
      return 503;
    case status.INTERNAL:
    default:
      return 500;
  }
}

export class AuthClientUnknownError extends Error {}
