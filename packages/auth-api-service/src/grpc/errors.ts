import * as grpc from '@grpc/grpc-js';
import {
  AUTH_ERROR_NAME_METADATA_KEY,
  AuthErrorName,
  isAuthErrorName
} from 'auth-public-types-lib';
import { AppErrorType } from 'common-types-lib';

/**
 * Metadata carrying a public auth error name. Names outside `AuthErrorName`
 * are internal and are not sent: clients then only see the gRPC status.
 */
export function authErrorMetadata(errorName: string): grpc.Metadata {
  const metadata = new grpc.Metadata();
  if (isAuthErrorName(errorName)) {
    metadata.set(AUTH_ERROR_NAME_METADATA_KEY, errorName);
  }
  return metadata;
}

export function toServiceError(payload: {
  errorName: string;
  errorType: AppErrorType;
  message: string;
}): grpc.ServiceError {
  const errorName = payload.errorName || 'CommandError';
  return {
    code: toGrpcStatus(payload.errorType),
    message: payload.message || 'Command processing failed',
    details: payload.message,
    name: errorName,
    metadata: authErrorMetadata(errorName)
  };
}

export function grantNotFoundServiceError(): grpc.ServiceError {
  const message = `Grant not found`;
  return {
    code: grpc.status.NOT_FOUND,
    message,
    details: message,
    name: AuthErrorName.GrantNotFound,
    metadata: authErrorMetadata(AuthErrorName.GrantNotFound)
  };
}

export function toGrpcStatus(errorType: AppErrorType): grpc.status {
  switch (errorType) {
    case 'InvalidArgument':
      return grpc.status.INVALID_ARGUMENT;
    case 'NotFound':
      return grpc.status.NOT_FOUND;
    case 'AlreadyExists':
      return grpc.status.ALREADY_EXISTS;
    case 'FailedPrecondition':
      return grpc.status.FAILED_PRECONDITION;
    case 'PermissionDenied':
      return grpc.status.PERMISSION_DENIED;
    case 'Unavailable':
      return grpc.status.UNAVAILABLE;
    case 'Aborted':
      return grpc.status.ABORTED;
    case 'Internal':
    default:
      return grpc.status.INTERNAL;
  }
}
