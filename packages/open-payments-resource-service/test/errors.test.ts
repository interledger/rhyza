import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ILogger, NullLogger } from 'common-types-lib';
import {
  createErrorHandler,
  OpenPaymentsResourceServerRouteError
} from '../src/errors';

interface HandledError {
  statusCode: number;
  body: unknown;
}

/**
 * Runs an error through the handler and returns what it sent, so each test can
 * assert on the status and response body a client would receive.
 */
function handle(
  error: Error,
  logger: ILogger = new NullLogger()
): HandledError {
  let statusCode = 0;
  let body: unknown;
  const reply = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    send(payload: unknown) {
      body = payload;
      return this;
    }
  };

  createErrorHandler(logger)(
    error as FastifyError,
    {} as FastifyRequest,
    reply as unknown as FastifyReply
  );

  return { statusCode, body };
}

test('maps a validation error to 400 invalid_request', () => {
  const error = new Error('body must have required property') as FastifyError;
  error.validation = [];

  assert.deepEqual(handle(error), {
    statusCode: 400,
    body: {
      error: {
        code: 'invalid_request',
        description: 'body must have required property'
      }
    }
  });
});

test('maps a route error to its own status, code and message', () => {
  const error = new OpenPaymentsResourceServerRouteError(
    404,
    'Incoming payment not found',
    'not_found'
  );

  assert.deepEqual(handle(error), {
    statusCode: 404,
    body: {
      error: {
        code: 'not_found',
        description: 'Incoming payment not found'
      }
    }
  });
});

test('includes details on a route error that carries them', () => {
  const error = new OpenPaymentsResourceServerRouteError(
    403,
    'Insufficient Grant',
    'insufficient_grant',
    { identifier: 'https://op.example/alice' }
  );

  assert.deepEqual(handle(error), {
    statusCode: 403,
    body: {
      error: {
        code: 'insufficient_grant',
        description: 'Insufficient Grant',
        details: { identifier: 'https://op.example/alice' }
      }
    }
  });
});

test('omits details on a route error without them', () => {
  const error = new OpenPaymentsResourceServerRouteError(
    400,
    'Could not create incoming payment',
    'invalid_request'
  );

  assert.equal(
    Object.hasOwn((handle(error).body as { error: object }).error, 'details'),
    false
  );
});

test('answers 500 for an unrecognized error', () => {
  assert.deepEqual(handle(new Error('unexpected')), {
    statusCode: 500,
    body: {
      error: {
        code: 'internal_server_error',
        description: 'Unhandled error'
      }
    }
  });
});

test('logs an unrecognized error rather than leaking it to the client', () => {
  const logged: unknown[][] = [];
  const logger = {
    error: (...args: unknown[]) => logged.push(args)
  } as unknown as ILogger;
  const error = new Error('connection refused to payments service');

  handle(error, logger);

  assert.equal(logged.length, 1);
  assert.deepEqual(logged[0], [error, 'Unhandled error']);
});

test('does not log an error a route already mapped', () => {
  const logged: unknown[][] = [];
  const logger = {
    error: (...args: unknown[]) => logged.push(args)
  } as unknown as ILogger;

  handle(
    new OpenPaymentsResourceServerRouteError(404, 'Not found', 'not_found'),
    logger
  );

  assert.equal(logged.length, 0);
});
