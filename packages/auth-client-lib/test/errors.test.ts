'use strict';

import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Metadata, ServiceError, status } from '@grpc/grpc-js';
import { AUTH_ERROR_NAME_METADATA_KEY } from 'auth-public-types-lib';
import {
  AuthClientAlreadyExistsError,
  AuthClientDuplicateGrantError,
  AuthClientError,
  AuthClientGrantNotFoundError,
  AuthClientInvalidGrantError,
  AuthClientInvalidGrantInputError,
  AuthClientInvalidInputError,
  AuthClientNotFoundError,
  AuthClientPermissionDeniedError,
  AuthClientUnauthorizedRequestError,
  AuthClientUnknownError,
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

function errorFor(errorName: string, code: status): AuthClientError {
  return clientErrorFromGrpcError(grpcError(code, 'domain message', errorName));
}

describe('clientErrorFromGrpcError', () => {
  test('maps a not-found domain error', () => {
    const err = errorFor('GrantNotFoundError', status.NOT_FOUND);
    assert.equal(err.constructor, AuthClientGrantNotFoundError);
    assert.equal(err.name, AuthClientGrantNotFoundError.name);
    assert.equal(err.message, 'domain message');
  });

  test('maps an invalid-argument domain error', () => {
    assert.equal(
      errorFor('InvalidGrantInputError', status.INVALID_ARGUMENT).constructor,
      AuthClientInvalidGrantInputError
    );
  });

  test('maps a permission-denied domain error', () => {
    assert.equal(
      errorFor('UnauthorizedRequestError', status.PERMISSION_DENIED)
        .constructor,
      AuthClientUnauthorizedRequestError
    );
  });

  test('maps a failed-precondition domain error', () => {
    assert.equal(
      errorFor('InvalidGrantError', status.FAILED_PRECONDITION).constructor,
      AuthClientInvalidGrantError
    );
  });

  test('maps an already-exists domain error', () => {
    assert.equal(
      errorFor('DuplicateGrantError', status.ALREADY_EXISTS).constructor,
      AuthClientDuplicateGrantError
    );
  });

  test('falls back to a status error without a known error name', () => {
    assert.equal(
      clientErrorFromGrpcError(grpcError(status.NOT_FOUND, 'message'))
        .constructor,
      AuthClientNotFoundError
    );
    assert.equal(
      clientErrorFromGrpcError(grpcError(status.INVALID_ARGUMENT, 'message'))
        .constructor,
      AuthClientInvalidInputError
    );
    assert.equal(
      clientErrorFromGrpcError(grpcError(status.PERMISSION_DENIED, 'message'))
        .constructor,
      AuthClientPermissionDeniedError
    );
    assert.equal(
      clientErrorFromGrpcError(grpcError(status.FAILED_PRECONDITION, 'message'))
        .constructor,
      AuthClientInvalidGrantError
    );
    assert.equal(
      clientErrorFromGrpcError(grpcError(status.ALREADY_EXISTS, 'message'))
        .constructor,
      AuthClientAlreadyExistsError
    );
    assert.equal(
      clientErrorFromGrpcError(grpcError(status.INTERNAL, 'message'))
        .constructor,
      AuthClientUnknownError
    );
  });

  test('falls back to a status error for an unknown error name', () => {
    const err = clientErrorFromGrpcError(
      grpcError(status.NOT_FOUND, 'message', 'SomeOtherError')
    );
    assert.equal(err.constructor, AuthClientNotFoundError);
    assert.equal(err.message, 'message');
  });

  test('ignores inherited object keys as error names', () => {
    assert.equal(
      clientErrorFromGrpcError(
        grpcError(status.INTERNAL, 'message', 'toString')
      ).constructor,
      AuthClientUnknownError
    );
  });

  test('wraps non-gRPC errors as AuthClientUnknownError', () => {
    const err = clientErrorFromGrpcError(new Error('random'));
    assert.equal(err.constructor, AuthClientUnknownError);
    assert.equal(err.message, 'Unknown error occurred: random');
  });
});
