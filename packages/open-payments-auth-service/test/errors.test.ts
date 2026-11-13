import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
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
  AuthClientUnknownError,
  AuthClientUnknownInteractionError
} from 'auth-client-lib';
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

test('maps AuthClientNotFoundError to 404 invalid_request', () => {
  assert.deepEqual(handle(new AuthClientNotFoundError('not found')), {
    statusCode: 404,
    body: { error: { code: 'invalid_request', description: 'grant not found' } }
  });
});

test('maps AuthClientInvalidInputError to 400 invalid_request', () => {
  assert.deepEqual(handle(new AuthClientInvalidInputError('invalid input')), {
    statusCode: 400,
    body: { error: { code: 'invalid_request', description: 'invalid request' } }
  });
});

test('maps AuthClientPermissionDeniedError to 401 invalid_client', () => {
  assert.deepEqual(handle(new AuthClientPermissionDeniedError('denied')), {
    statusCode: 401,
    body: {
      error: { code: 'invalid_client', description: 'invalid signature' }
    }
  });
});

test('maps AuthClientInvalidGrantError to 401 request_denied', () => {
  assert.deepEqual(handle(new AuthClientInvalidGrantError('invalid grant')), {
    statusCode: 401,
    body: {
      error: {
        code: 'request_denied',
        description: 'grant cannot be continued'
      }
    }
  });
});

test('maps AuthClientContinuationTooFastError to 400 too_fast', () => {
  assert.deepEqual(handle(new AuthClientContinuationTooFastError('too soon')), {
    statusCode: 400,
    body: {
      error: {
        code: 'too_fast',
        description: 'continued grant faster than "wait" period'
      }
    }
  });
});

test('maps AuthClientInvalidContinuationError to 401 invalid_continuation', () => {
  assert.deepEqual(
    handle(new AuthClientInvalidContinuationError('bad continue token')),
    {
      statusCode: 401,
      body: {
        error: { code: 'invalid_continuation', description: 'invalid grant' }
      }
    }
  );
});

test('maps AuthClientInvalidRotationError to 401 invalid_rotation', () => {
  assert.deepEqual(handle(new AuthClientInvalidRotationError('revoked')), {
    statusCode: 401,
    body: {
      error: { code: 'invalid_rotation', description: 'Could not rotate token' }
    }
  });
});

// The client lib's errors are flat, so each specific error needs its own entry
// in the mapping rather than inheriting one from a status-code group.
test('maps AuthClientGrantNotFoundError to 404 invalid_request', () => {
  assert.deepEqual(handle(new AuthClientGrantNotFoundError('no grant')), {
    statusCode: 404,
    body: { error: { code: 'invalid_request', description: 'grant not found' } }
  });
});

test('maps AuthClientUnknownAccessTokenError to 404 invalid_request', () => {
  assert.deepEqual(handle(new AuthClientUnknownAccessTokenError('no token')), {
    statusCode: 404,
    body: { error: { code: 'invalid_request', description: 'grant not found' } }
  });
});

test('maps AuthClientUnknownInteractionError to 404 invalid_request', () => {
  assert.deepEqual(
    handle(new AuthClientUnknownInteractionError('no interaction')),
    {
      statusCode: 404,
      body: {
        error: { code: 'invalid_request', description: 'grant not found' }
      }
    }
  );
});

test('maps AuthClientInvalidGrantInputError to 400 invalid_request', () => {
  assert.deepEqual(handle(new AuthClientInvalidGrantInputError('bad input')), {
    statusCode: 400,
    body: { error: { code: 'invalid_request', description: 'invalid request' } }
  });
});

test('maps AuthClientUnauthorizedRequestError to 401 invalid_client', () => {
  assert.deepEqual(
    handle(new AuthClientUnauthorizedRequestError('unauthorized')),
    {
      statusCode: 401,
      body: {
        error: { code: 'invalid_client', description: 'invalid signature' }
      }
    }
  );
});

test('maps AuthClientInsufficientGrantError to 401 request_denied', () => {
  assert.deepEqual(
    handle(new AuthClientInsufficientGrantError('insufficient')),
    {
      statusCode: 401,
      body: {
        error: {
          code: 'request_denied',
          description: 'grant cannot be continued'
        }
      }
    }
  );
});

test('maps AuthClientInvalidInteractionError to 401 request_denied', () => {
  assert.deepEqual(
    handle(new AuthClientInvalidInteractionError('invalid interaction')),
    {
      statusCode: 401,
      body: {
        error: {
          code: 'request_denied',
          description: 'grant cannot be continued'
        }
      }
    }
  );
});

test('maps AuthClientNonInteractiveGrantError to 401 request_denied', () => {
  assert.deepEqual(
    handle(new AuthClientNonInteractiveGrantError('non-interactive')),
    {
      statusCode: 401,
      body: {
        error: {
          code: 'request_denied',
          description: 'grant cannot be continued'
        }
      }
    }
  );
});

test('maps AuthClientUnknownError to 500 request_denied', () => {
  assert.deepEqual(handle(new AuthClientUnknownError('timeout exceeded')), {
    statusCode: 500,
    body: { error: { code: 'request_denied', description: 'Unhandled error' } }
  });
});

test('maps an unrecognized error to 500 request_denied', () => {
  assert.deepEqual(handle(new Error('boom')), {
    statusCode: 500,
    body: { error: { code: 'request_denied', description: 'Unhandled error' } }
  });
});

test('uses the mapped description, not the auth BC message', () => {
  const { body } = handle(
    new AuthClientPermissionDeniedError('internal detail')
  );

  assert.deepEqual(body, {
    error: { code: 'invalid_client', description: 'invalid signature' }
  });
});
