/**
 * gRPC trailing metadata key that carries the auth BC domain error name
 * (e.g. `InvalidContinuationError`) on a failed call, so clients can tell
 * apart errors that share a gRPC status code.
 */
export const AUTH_ERROR_NAME_METADATA_KEY = 'x-auth-error-name';

/**
 * Domain error names the auth BC sends in `AUTH_ERROR_NAME_METADATA_KEY`.
 */
export const AuthErrorName = {
  GrantNotFound: 'GrantNotFoundError',
  DuplicateGrant: 'DuplicateGrantError',
  InvalidGrant: 'InvalidGrantError',
  InvalidGrantInput: 'InvalidGrantInputError',
  InsufficientGrant: 'InsufficientGrantError',
  UnknownAccessToken: 'UnknownAccessTokenError',
  UnknownInteraction: 'UnknownInteractionError',
  InvalidInteraction: 'InvalidInteractionError',
  UnauthorizedRequest: 'UnauthorizedRequestError',
  ContinuationTooFast: 'ContinuationTooFastError',
  InvalidContinuation: 'InvalidContinuationError',
  InvalidTokenRotation: 'InvalidTokenRotationError'
} as const;

export type AuthErrorName = (typeof AuthErrorName)[keyof typeof AuthErrorName];

export function isAuthErrorName(value: unknown): value is AuthErrorName {
  return (
    typeof value === 'string' &&
    (Object.values(AuthErrorName) as string[]).includes(value)
  );
}
