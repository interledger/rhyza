import { ServiceError, status } from '@grpc/grpc-js';
import {
  AUTH_ERROR_NAME_METADATA_KEY,
  AuthErrorName,
  isAuthErrorName
} from 'auth-public-types-lib';
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

// Specific errors, one per AuthErrorName the auth BC sends in gRPC metadata.
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
export class AuthClientDuplicateGrantError extends AuthClientError {}

// Fallbacks, used when the auth BC did not send a domain error name (or sent
// one this client does not know about). One per gRPC status code we map.
export class AuthClientUnknownError extends AuthClientError {}
export class AuthClientPermissionDeniedError extends AuthClientError {}
export class AuthClientInvalidInputError extends AuthClientError {}
export class AuthClientNotFoundError extends AuthClientError {}
export class AuthClientAlreadyExistsError extends AuthClientError {}

export function isAuthClientError(err: unknown): err is AuthClientError {
  return err instanceof AuthClientError;
}

function domainErrorName(err: ServiceError): AuthErrorName | undefined {
  const [value] = err.metadata?.get(AUTH_ERROR_NAME_METADATA_KEY) ?? [];
  return isAuthErrorName(value) ? value : undefined;
}

function clientErrorFromDomainName(
  name: AuthErrorName,
  message: string
): AuthClientError {
  switch (name) {
    case AuthErrorName.GrantNotFound:
      return new AuthClientGrantNotFoundError(message);
    case AuthErrorName.DuplicateGrant:
      return new AuthClientDuplicateGrantError(message);
    case AuthErrorName.InvalidGrant:
      return new AuthClientInvalidGrantError(message);
    case AuthErrorName.InvalidGrantInput:
      return new AuthClientInvalidGrantInputError(message);
    case AuthErrorName.InsufficientGrant:
      return new AuthClientInsufficientGrantError(message);
    case AuthErrorName.UnknownAccessToken:
      return new AuthClientUnknownAccessTokenError(message);
    case AuthErrorName.UnknownInteraction:
      return new AuthClientUnknownInteractionError(message);
    case AuthErrorName.InvalidInteraction:
      return new AuthClientInvalidInteractionError(message);
    case AuthErrorName.UnauthorizedRequest:
      return new AuthClientUnauthorizedRequestError(message);
    case AuthErrorName.ContinuationTooFast:
      return new AuthClientContinuationTooFastError(message);
    case AuthErrorName.InvalidContinuation:
      return new AuthClientInvalidContinuationError(message);
    case AuthErrorName.InvalidTokenRotation:
      return new AuthClientInvalidRotationError(message);
    default: {
      const unhandled: never = name;
      throw new Error(`Unhandled auth error name: ${unhandled}`);
    }
  }
}

export function clientErrorFromGrpcError(err: unknown): AuthClientError {
  if (!isGrpcServiceError(err)) {
    return new AuthClientUnknownError(
      `Unknown error occurred: ${err instanceof Error ? err.message : err}`
    );
  }

  const message = err.details || err.message;
  const name = domainErrorName(err);

  if (name) {
    return clientErrorFromDomainName(name, message);
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
