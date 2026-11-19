import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { status } from '@grpc/grpc-js';
import * as domainErrors from 'auth-domain-lib/src/grant/errors';
import {
  AUTH_ERROR_NAME_METADATA_KEY,
  AuthErrorName
} from 'auth-public-types-lib';
import { AppError } from 'common-types-lib';

import { grantNotFoundServiceError, toServiceError } from '../src/grpc/errors';

type DomainErrorClass = new (message?: string) => AppError;

const domainErrorNames = Object.values(domainErrors)
  .filter(
    (value): value is DomainErrorClass =>
      typeof value === 'function' && value.prototype instanceof AppError
  )
  .map((ErrorClass) => new ErrorClass().name)
  .sort();

describe('AuthErrorName', () => {
  it('matches the auth domain error names', () => {
    assert.deepEqual(
      [...Object.values(AuthErrorName)].sort(),
      domainErrorNames
    );
  });
});

describe('toServiceError', () => {
  it('sends a public error name in metadata', () => {
    const err = toServiceError({
      errorName: AuthErrorName.DuplicateGrant,
      errorType: 'AlreadyExists',
      message: 'duplicate'
    });
    assert.equal(err.code, status.ALREADY_EXISTS);
    assert.equal(err.details, 'duplicate');
    assert.deepEqual(err.metadata.get(AUTH_ERROR_NAME_METADATA_KEY), [
      AuthErrorName.DuplicateGrant
    ]);
  });

  it('does not send an internal error name', () => {
    const err = toServiceError({
      errorName: 'InvalidCursorError',
      errorType: 'InvalidArgument',
      message: 'bad cursor'
    });
    assert.equal(err.code, status.INVALID_ARGUMENT);
    assert.deepEqual(err.metadata.get(AUTH_ERROR_NAME_METADATA_KEY), []);
  });
});

describe('grantNotFoundServiceError', () => {
  it('sends GrantNotFoundError in metadata', () => {
    const err = grantNotFoundServiceError();
    assert.equal(err.code, status.NOT_FOUND);
    assert.deepEqual(err.metadata.get(AUTH_ERROR_NAME_METADATA_KEY), [
      AuthErrorName.GrantNotFound
    ]);
  });
});
