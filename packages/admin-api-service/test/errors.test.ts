'use strict';

import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  AuthClientAlreadyExistsError,
  AuthClientDuplicateGrantError,
  AuthClientGrantNotFoundError
} from 'auth-client-lib';
import { httpStatusFromAuthClientError } from '../src/errors.js';

describe('httpStatusFromAuthClientError', () => {
  test('maps an auth client error to its mapped status', () => {
    assert.equal(
      httpStatusFromAuthClientError(
        new AuthClientGrantNotFoundError('message')
      ),
      404
    );
  });

  test('maps duplicate-grant and already-exists errors to 409', () => {
    assert.equal(
      httpStatusFromAuthClientError(new AuthClientDuplicateGrantError('x')),
      409
    );
    assert.equal(
      httpStatusFromAuthClientError(new AuthClientAlreadyExistsError('x')),
      409
    );
  });

  test('maps a non-auth-client error to 500', () => {
    assert.equal(httpStatusFromAuthClientError(new Error('other')), 500);
    assert.equal(httpStatusFromAuthClientError('other'), 500);
    assert.equal(httpStatusFromAuthClientError(undefined), 500);
  });
});
