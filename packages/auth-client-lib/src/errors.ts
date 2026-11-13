import { ServiceError, status } from '@grpc/grpc-js';
import { AUTH_ERROR_NAME_METADATA_KEY } from 'auth-public-types-lib';
export function isGrpcServiceError(err: unknown): err is ServiceError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as ServiceError).code === 'number'
  );
}

export class AuthClientError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

// Specific errors, keyed by the auth BC domain error name sent in gRPC metadata.
export class AuthClientInvalidGrantError extends AuthClientError {}
export class AuthClientGrantNotFoundError extends AuthClientError {}
export class AuthClientUnknownAccessTokenError extends AuthClientError {}
export class AuthClientUnknownInteractionError extends AuthClientError {}
export class AuthClientInvalidGrantInputError extends AuthClientError {}
export class AuthClientUnauthorizedRequestError extends AuthClientError {}
export class AuthClientContinuationTooFastError extends AuthClientError {}
export class AuthClientInvalidContinuationError extends AuthClientError {}
export class AuthClientInvalidRotationError extends AuthClientError {}
export class AuthClientInsufficientGrantError extends AuthClientError {}
export class AuthClientInvalidInteractionError extends AuthClientError {}
export class AuthClientNonInteractiveGrantError extends AuthClientError {}
export class AuthClientDuplicateGrantError extends AuthClientError {}

// Fallbacks, used when the auth BC did not send a domain error name (or sent
// one this client does not know about). One per gRPC status code we map.
export class AuthClientUnknownError extends AuthClientError {}
export class AuthClientPermissionDeniedError extends AuthClientError {}
export class AuthClientInvalidInputError extends AuthClientError {}
export class AuthClientNotFoundError extends AuthClientError {}
export class AuthClientAlreadyExistsError extends AuthClientError {}

type AuthClientErrorConstructor = new (message?: string) => AuthClientError;

const ERRORS_BY_DOMAIN_NAME: Record<string, AuthClientErrorConstructor> = {
  GrantNotFoundError: AuthClientGrantNotFoundError,
  UnknownAccessTokenError: AuthClientUnknownAccessTokenError,
  UnknownInteractionError: AuthClientUnknownInteractionError,
  InvalidGrantInputError: AuthClientInvalidGrantInputError,
  UnauthorizedRequestError: AuthClientUnauthorizedRequestError,
  ContinuationTooFastError: AuthClientContinuationTooFastError,
  InvalidContinuationError: AuthClientInvalidContinuationError,
  InvalidTokenRotationError: AuthClientInvalidRotationError,
  InsufficientGrantError: AuthClientInsufficientGrantError,
  InvalidInteractionError: AuthClientInvalidInteractionError,
  NonInteractiveGrantError: AuthClientNonInteractiveGrantError,
  InvalidGrantError: AuthClientInvalidGrantError,
  DuplicateGrantError: AuthClientDuplicateGrantError
};

export function isAuthClientError(err: unknown): err is AuthClientError {
  return err instanceof AuthClientError;
}

function domainErrorName(err: ServiceError): string | undefined {
  const [value] = err.metadata?.get(AUTH_ERROR_NAME_METADATA_KEY) ?? [];
  return typeof value === 'string' ? value : undefined;
}

export function clientErrorFromGrpcError(err: unknown): AuthClientError {
  if (!isGrpcServiceError(err)) {
    return new AuthClientUnknownError(
      `Unknown error occurred: ${err instanceof Error ? err.message : err}`
    );
  }

  const message = err.details || err.message;
  const name = domainErrorName(err);

  if (name && Object.hasOwn(ERRORS_BY_DOMAIN_NAME, name)) {
    return new ERRORS_BY_DOMAIN_NAME[name](message);
  }

  switch (err.code) {
    case status.PERMISSION_DENIED:
      return new AuthClientPermissionDeniedError(message);
    case status.INVALID_ARGUMENT:
      return new AuthClientInvalidInputError(message);
    case status.NOT_FOUND:
      return new AuthClientNotFoundError(message);
    case status.ALREADY_EXISTS:
      return new AuthClientAlreadyExistsError(message);
    case status.FAILED_PRECONDITION:
      return new AuthClientInvalidGrantError(message);
    default:
      return new AuthClientUnknownError(message);
  }
}
