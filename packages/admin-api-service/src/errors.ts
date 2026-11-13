'use strict';

import {
  AuthClientContinuationTooFastError,
  AuthClientGrantNotFoundError,
  AuthClientInsufficientGrantError,
  AuthClientInvalidContinuationError,
  AuthClientInvalidGrantError,
  AuthClientInvalidGrantInputError,
  AuthClientInvalidInputError,
  AuthClientInvalidInteractionError,
  AuthClientInvalidRotationError,
  AuthClientNonInteractiveGrantError,
  AuthClientNotFoundError,
  AuthClientPermissionDeniedError,
  AuthClientUnauthorizedRequestError,
  AuthClientUnknownAccessTokenError,
  AuthClientUnknownInteractionError,
  isAuthClientError
} from 'auth-client-lib';

const HTTP_STATUS_BY_ERROR_NAME: Record<string, number> = {
  [AuthClientPermissionDeniedError.name]: 401,
  [AuthClientUnauthorizedRequestError.name]: 401,
  [AuthClientInvalidInputError.name]: 400,
  [AuthClientInvalidGrantInputError.name]: 400,
  [AuthClientNotFoundError.name]: 404,
  [AuthClientGrantNotFoundError.name]: 404,
  [AuthClientUnknownAccessTokenError.name]: 404,
  [AuthClientUnknownInteractionError.name]: 404,
  [AuthClientInvalidGrantError.name]: 409,
  [AuthClientContinuationTooFastError.name]: 409,
  [AuthClientInvalidContinuationError.name]: 409,
  [AuthClientInvalidRotationError.name]: 409,
  [AuthClientInsufficientGrantError.name]: 409,
  [AuthClientInvalidInteractionError.name]: 409,
  [AuthClientNonInteractiveGrantError.name]: 409
};

export function httpStatusFromAuthClientError(err: unknown): number {
  if (!isAuthClientError(err)) return 500;
  if (!Object.hasOwn(HTTP_STATUS_BY_ERROR_NAME, err.name)) return 500;
  return HTTP_STATUS_BY_ERROR_NAME[err.name];
}
