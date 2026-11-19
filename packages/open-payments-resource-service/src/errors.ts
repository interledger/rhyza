import { FastifyRequest, FastifyReply, FastifyError } from 'fastify';
import { components } from './types/generated/resource-server-types.js';

const ResourceServerErrorCode = {
  invalid_request: 'invalid_request',
  not_found: 'not_found',
  invalid_token: 'invalid_token',
  invalid_signature: 'invalid_signature',
  inactive_token: 'inactive_token',
  insufficient_grant: 'insufficient_grant',
  internal_server_error: 'internal_server_error'
} as const;
type ResourceServerErrorCode = keyof typeof ResourceServerErrorCode;

type HTTPStatus = 400 | 401 | 403 | 404 | 500;

export class OpenPaymentsResourceServerRouteError extends Error {
  public status: HTTPStatus;
  public code: ResourceServerErrorCode;
  public details?: Record<string, unknown>;

  constructor(
    status: HTTPStatus,
    message: string,
    code: ResourceServerErrorCode,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'OpenPaymentsResourceServerRouteError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function errorHandler(
  error: FastifyError,
  _: FastifyRequest,
  reply: FastifyReply
) {
  let resourceServerError: components['schemas']['error-response'];
  let statusCode: number;

  if (error.validation) {
    statusCode = 400;
    resourceServerError = {
      error: {
        code: 'invalid_request',
        description: error.message
      }
    };
  } else if (error instanceof OpenPaymentsResourceServerRouteError) {
    statusCode = error.status;
    resourceServerError = {
      error: {
        code: error.code,
        description: error.message,
        ...(error.details && { details: error.details })
      }
    };
  } else {
    console.error(error);

    statusCode = 500;
    resourceServerError = {
      error: {
        code: 'internal_server_error',
        description: 'Unhandled error'
      }
    };
  }

  reply.status(statusCode).send(resourceServerError);
}
