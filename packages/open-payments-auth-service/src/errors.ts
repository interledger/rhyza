import { FastifyRequest, FastifyReply, FastifyError } from 'fastify';
import {
  AuthClientContinuationTooFastError,
  AuthClientError,
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

const AuthServerErrorCode = {
  invalid_client: 'invalid_client',
  invalid_request: 'invalid_request',
  request_denied: 'request_denied',
  too_fast: 'too_fast',
  invalid_continuation: 'invalid_continuation',
  invalid_rotation: 'invalid_rotation'
} as const;
type AuthServerErrorCode = keyof typeof AuthServerErrorCode;

type HTTPStatus = 400 | 401 | 404 | 500 | 501;

interface AuthServerErrorResponse {
  error: {
    code: AuthServerErrorCode;
    description: string;
  };
}

export class OpenPaymentsAuthServerRouteError extends Error {
  public status: HTTPStatus;
  public code: AuthServerErrorCode;
  public details?: Record<string, unknown>;

  constructor(
    status: HTTPStatus,
    message: string,
    code: AuthServerErrorCode,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'OpenPaymentsAuthServerRouteError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

interface AuthServerError {
  status: HTTPStatus;
  code: AuthServerErrorCode;
  description: string;
}

const INVALID_REQUEST: AuthServerError = {
  status: 400,
  code: 'invalid_request',
  description: 'invalid request'
};
const INVALID_CLIENT: AuthServerError = {
  status: 401,
  code: 'invalid_client',
  description: 'invalid signature'
};
const GRANT_NOT_FOUND: AuthServerError = {
  status: 404,
  code: 'invalid_request',
  description: 'grant not found'
};
const REQUEST_DENIED: AuthServerError = {
  status: 401,
  code: 'request_denied',
  description: 'grant cannot be continued'
};
const UNHANDLED: AuthServerError = {
  status: 500,
  code: 'request_denied',
  description: 'Unhandled error'
};

const ERRORS_BY_CLIENT_ERROR_NAME: Record<string, AuthServerError> = {
  [AuthClientContinuationTooFastError.name]: {
    status: 400,
    code: 'too_fast',
    description: 'continued grant faster than "wait" period'
  },
  [AuthClientInvalidContinuationError.name]: {
    status: 401,
    code: 'invalid_continuation',
    description: 'invalid grant'
  },
  [AuthClientInvalidRotationError.name]: {
    status: 401,
    code: 'invalid_rotation',
    description: 'Could not rotate token'
  },
  [AuthClientNotFoundError.name]: GRANT_NOT_FOUND,
  [AuthClientGrantNotFoundError.name]: GRANT_NOT_FOUND,
  [AuthClientUnknownAccessTokenError.name]: GRANT_NOT_FOUND,
  [AuthClientUnknownInteractionError.name]: GRANT_NOT_FOUND,
  [AuthClientInvalidInputError.name]: INVALID_REQUEST,
  [AuthClientInvalidGrantInputError.name]: INVALID_REQUEST,
  [AuthClientPermissionDeniedError.name]: INVALID_CLIENT,
  [AuthClientUnauthorizedRequestError.name]: INVALID_CLIENT,
  [AuthClientInvalidGrantError.name]: REQUEST_DENIED,
  [AuthClientInsufficientGrantError.name]: REQUEST_DENIED,
  [AuthClientInvalidInteractionError.name]: REQUEST_DENIED,
  [AuthClientNonInteractiveGrantError.name]: REQUEST_DENIED
};

function toAuthServerErrorResponse(error: AuthClientError): AuthServerError {
  if (!Object.hasOwn(ERRORS_BY_CLIENT_ERROR_NAME, error.name)) return UNHANDLED;
  return ERRORS_BY_CLIENT_ERROR_NAME[error.name];
}

export function errorHandler(
  error: FastifyError,
  _: FastifyRequest,
  reply: FastifyReply
) {
  let authServerError: AuthServerErrorResponse;
  let statusCode: number;

  if (error.validation) {
    statusCode = 400;
    authServerError = {
      error: {
        code: 'invalid_request',
        description: error.message
      }
    };
  } else if (error instanceof OpenPaymentsAuthServerRouteError) {
    statusCode = error.status;
    authServerError = {
      error: {
        code: error.code,
        description: error.message
      }
    };
  } else if (isAuthClientError(error)) {
    const { code, description, status } = toAuthServerErrorResponse(error);

    statusCode = status;
    authServerError = {
      error: {
        code,
        description
      }
    };
  } else {
    console.error(error);

    statusCode = 500;
    authServerError = {
      error: {
        code: 'request_denied',
        description: 'Unhandled error'
      }
    };
  }

  reply.status(statusCode).send(authServerError);
}
