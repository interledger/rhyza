import { ServiceError, status } from '@grpc/grpc-js';
export function isGrpcServiceError(err: unknown): err is ServiceError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as ServiceError).code === 'number'
  );
}

export class AuthClientError extends Error {}
export class AuthClientUnknownError extends AuthClientError {}
export class AuthClientPermissionDeniedError extends AuthClientError {}
export class AuthClientInvalidInputError extends AuthClientError {}
export class AuthClientNotFoundError extends AuthClientError {}
export class AuthClientInvalidGrantError extends AuthClientError {}

export function isAuthClientError(err: unknown): err is AuthClientError {
  return err instanceof AuthClientError;
}

export function clientErrorFromGrpcError(err: unknown): AuthClientError {
  if (!isGrpcServiceError(err)) {
    return new AuthClientUnknownError(
      `Unknown error occurred: ${err instanceof Error ? err.message : err}`
    );
  }

  switch (err.code) {
    case status.PERMISSION_DENIED:
      return new AuthClientPermissionDeniedError(err.message);
    case status.INVALID_ARGUMENT:
      return new AuthClientInvalidInputError(err.message);
    case status.NOT_FOUND:
      return new AuthClientNotFoundError(err.message);
    case status.FAILED_PRECONDITION:
      return new AuthClientInvalidGrantError(err.message);
    default:
      return new AuthClientUnknownError(err.message);
  }
}

export function httpStatusFromClientError(err: unknown): number {
  if (!isAuthClientError(err)) return 500;
  switch (err.constructor.name) {
    case AuthClientPermissionDeniedError.constructor.name:
      return 401;
    case AuthClientInvalidInputError.constructor.name:
      return 400;
    case AuthClientNotFoundError.constructor.name:
      return 404;
    case AuthClientInvalidGrantError.constructor.name:
      return 409;
    case AuthClientUnknownError.constructor.name:
    default:
      return 500;
  }
}
