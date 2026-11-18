import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AuthClientInsufficientGrantError } from 'auth-client-lib';
import { errorHandler, OpenPaymentsAuthServerRouteError } from '../src/errors';

interface HandledError {
  statusCode: number;
  body: unknown;
}

/**
 * Runs an error through the handler and returns what it sent, so each test can
 * assert on the status and response body a client would receive.
 */
function handle(error: Error): HandledError {
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

  errorHandler(
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
  const error = new OpenPaymentsAuthServerRouteError(
    401,
    'invalid signature headers',
    'invalid_client'
  );

  assert.deepEqual(handle(error), {
    statusCode: 401,
    body: {
      error: {
        code: 'invalid_client',
        description: 'invalid signature headers'
      }
    }
  });
});

test('answers 500 for an auth client error a route did not map', () => {
  assert.deepEqual(handle(new AuthClientInsufficientGrantError('spent')), {
    statusCode: 500,
    body: { error: { code: 'request_denied', description: 'Unhandled error' } }
  });
});

test('answers 500 for an unrecognized error', () => {
  assert.deepEqual(handle(new Error('boom')), {
    statusCode: 500,
    body: { error: { code: 'request_denied', description: 'Unhandled error' } }
  });
});
