'use strict';

import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Metadata, ServiceError, status } from '@grpc/grpc-js';
import { AUTH_ERROR_NAME_METADATA_KEY } from 'auth-public-types-lib';
import {
  AuthClientAlreadyExistsError,
  AuthClientContinuationTooFastError,
  AuthClientDuplicateGrantError,
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
  AuthClientUnknownError,
  AuthClientUnknownInteractionError,
  clientErrorFromGrpcError
} from '../src/errors';

function grpcError(
  code: status,
  details: string,
  errorName?: string
): ServiceError {
  const metadata = new Metadata();
  if (errorName) metadata.set(AUTH_ERROR_NAME_METADATA_KEY, errorName);
  return Object.assign(new Error(`${code} ${status[code]}: ${details}`), {
    code,
    details,
    metadata
  });
}

describe('clientErrorFromGrpcError', () => {
  const byName = [
    ['GrantNotFoundError', status.NOT_FOUND, AuthClientGrantNotFoundError],
    [
      'UnknownAccessTokenError',
      status.NOT_FOUND,
      AuthClientUnknownAccessTokenError
    ],
    [
      'UnknownInteractionError',
      status.NOT_FOUND,
      AuthClientUnknownInteractionError
    ],
    [
      'InvalidGrantInputError',
      status.INVALID_ARGUMENT,
      AuthClientInvalidGrantInputError
    ],
    [
      'UnauthorizedRequestError',
      status.PERMISSION_DENIED,
      AuthClientUnauthorizedRequestError
    ],
    [
      'ContinuationTooFastError',
      status.FAILED_PRECONDITION,
      AuthClientContinuationTooFastError
    ],
    [
      'InvalidContinuationError',
      status.FAILED_PRECONDITION,
      AuthClientInvalidContinuationError
    ],
    [
      'InvalidTokenRotationError',
      status.FAILED_PRECONDITION,
      AuthClientInvalidRotationError
    ],
    [
      'InsufficientGrantError',
      status.FAILED_PRECONDITION,
      AuthClientInsufficientGrantError
    ],
    [
      'InvalidInteractionError',
      status.FAILED_PRECONDITION,
      AuthClientInvalidInteractionError
    ],
    [
      'NonInteractiveGrantError',
      status.FAILED_PRECONDITION,
      AuthClientNonInteractiveGrantError
    ],
    [
      'InvalidGrantError',
      status.FAILED_PRECONDITION,
      AuthClientInvalidGrantError
    ],
    [
      'DuplicateGrantError',
      status.ALREADY_EXISTS,
      AuthClientDuplicateGrantError
    ]
  ] as const;

  for (const [errorName, code, expected] of byName) {
    test(`maps ${errorName} to ${expected.name}`, () => {
      const err = clientErrorFromGrpcError(
        grpcError(code, 'domain message', errorName)
      );
      assert.equal(err.constructor, expected);
      assert.equal(err.name, expected.name);
      assert.equal(err.message, 'domain message');
    });
  }

  test('errors are flat: every error extends AuthClientError directly', () => {
    for (const [errorName, code] of byName) {
      const err = clientErrorFromGrpcError(grpcError(code, 'x', errorName));
      assert.ok(err instanceof AuthClientError);
      assert.equal(
        Object.getPrototypeOf(err.constructor),
        AuthClientError,
        `${errorName} must extend AuthClientError directly`
      );
    }
  });

  const byStatus = [
    [status.PERMISSION_DENIED, AuthClientPermissionDeniedError],
    [status.INVALID_ARGUMENT, AuthClientInvalidInputError],
    [status.NOT_FOUND, AuthClientNotFoundError],
    [status.ALREADY_EXISTS, AuthClientAlreadyExistsError],
    [status.FAILED_PRECONDITION, AuthClientInvalidGrantError],
    [status.INTERNAL, AuthClientUnknownError]
  ] as const;

  for (const [code, expected] of byStatus) {
    test(`falls back to ${expected.name} for status ${status[code]} without a known error name`, () => {
      const unnamed = clientErrorFromGrpcError(grpcError(code, 'message'));
      assert.equal(unnamed.constructor, expected);
      assert.equal(unnamed.message, 'message');

      const unknownName = clientErrorFromGrpcError(
        grpcError(code, 'message', 'SomeOtherError')
      );
      assert.equal(unknownName.constructor, expected);
    });
  }

  test('ignores inherited object keys as error names', () => {
    const err = clientErrorFromGrpcError(
      grpcError(status.INTERNAL, 'message', 'toString')
    );
    assert.equal(err.constructor, AuthClientUnknownError);
  });

  test('wraps non-gRPC errors as AuthClientUnknownError', () => {
    const err = clientErrorFromGrpcError(new Error('boom'));
    assert.equal(err.constructor, AuthClientUnknownError);
    assert.equal(err.message, 'Unknown error occurred: boom');
  });
});
