export * from './proto_generated';

/**
 * gRPC trailing metadata key that carries the auth BC domain error name
 * (e.g. `InvalidContinuationError`) on a failed call, so clients can tell
 * apart errors that share a gRPC status code.
 */
export const AUTH_ERROR_NAME_METADATA_KEY = 'x-auth-error-name';
