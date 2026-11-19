import { FastifyRequest, FastifyReply, FastifyError } from 'fastify';
import { ILogger } from 'common-types-lib';

const AuthServerErrorCode = {
  invalid_client: 'invalid_client',
  invalid_request: 'invalid_request',
  request_denied: 'request_denied',
  too_fast: 'too_fast',
  invalid_continuation: 'invalid_continuation',
  invalid_rotation: 'invalid_rotation',
  invalid_interaction: 'invalid_interaction',
  unknown_interaction: 'unknown_interaction'
} as const;
type AuthServerErrorCode = keyof typeof AuthServerErrorCode;

type HTTPStatus = 400 | 401 | 403 | 404 | 500 | 501;

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

export function createErrorHandler(logger: ILogger) {
  return function errorHandler(
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
    } else {
      logger.error(error, 'Unhandled error');

      statusCode = 500;
      authServerError = {
        error: {
          code: 'request_denied',
          description: 'Unhandled error'
        }
      };
    }

    reply.status(statusCode).send(authServerError);
  };
}
