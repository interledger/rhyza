import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {
  AuthClient,
  AuthClientContinuationTooFastError,
  AuthClientGrantNotFoundError,
  AuthClientInsufficientGrantError,
  AuthClientInvalidContinuationError,
  AuthClientInvalidGrantError,
  AuthClientInvalidGrantInputError,
  AuthClientInvalidInteractionError,
  AuthClientUnauthorizedRequestError
} from 'auth-client-lib';
import { grantRoutes } from '../src/routes/grant';
import { createErrorHandler } from '../src/errors';
import { NullLogger } from 'common-types-lib';
import { createContinueResponse } from '../src/utils';

const AUTH_SERVER_URL = 'https://auth.example';
const SIGNATURE_HEADERS = {
  signature: 'sig1=:c2lnbmF0dXJl:',
  'signature-input': 'sig1=("@method" "@target-uri");keyid="key-1"'
};

/** An auth client whose grant calls all fail with the given error. */
function failingAuthClient(error: Error) {
  const fail = async () => {
    throw error;
  };
  return {
    createGrant: fail,
    continueGrant: fail,
    revokeGrant: fail
  } as unknown as AuthClient;
}

async function setup(error: Error) {
  const app = Fastify();
  // Request bodies are validated against the Open Payments spec in
  // service.ts; these tests are only about the auth client errors.
  app.setValidatorCompiler(() => () => true);
  app.setErrorHandler(createErrorHandler(new NullLogger()));
  await app.register(grantRoutes, {
    authClient: failingAuthClient(error),
    openPaymentsAuthServerUrl: AUTH_SERVER_URL
  });
  return app;
}

function createGrantRequest() {
  return {
    method: 'POST' as const,
    url: '/',
    headers: SIGNATURE_HEADERS,
    payload: {
      client: 'https://wallet.example/alice',
      access_token: {
        access: [{ type: 'incoming-payment', actions: ['create'] }]
      }
    }
  };
}

function continueRequest(method: 'POST' | 'DELETE') {
  const continueResponse = createContinueResponse(
    'grant-1',
    'continue-1',
    'continue-token',
    AUTH_SERVER_URL
  );
  return {
    method,
    url: new URL(continueResponse.uri).pathname,
    headers: {
      ...SIGNATURE_HEADERS,
      authorization: `GNAP ${continueResponse.access_token.value}`
    }
  };
}

interface ErrorCase {
  error: Error;
  status: number;
  code: string;
}

async function assertErrorResponse(
  request: ReturnType<typeof createGrantRequest | typeof continueRequest>,
  { error, status, code }: ErrorCase
) {
  const app = await setup(error);

  const response = await app.inject(request);

  assert.equal(response.statusCode, status);
  assert.equal(response.json().error.code, code);
}

describe('createGrant', () => {
  const cases: ErrorCase[] = [
    {
      error: new AuthClientUnauthorizedRequestError(),
      status: 401,
      code: 'invalid_client'
    },
    {
      error: new AuthClientInvalidGrantInputError(),
      status: 400,
      code: 'invalid_request'
    },
    {
      error: new AuthClientInsufficientGrantError(),
      status: 500,
      code: 'request_denied'
    }
  ];

  for (const errorCase of cases) {
    test(`answers ${errorCase.status} ${errorCase.code} for ${errorCase.error.name}`, () =>
      assertErrorResponse(createGrantRequest(), errorCase));
  }
});

describe('continueGrant', () => {
  const cases: ErrorCase[] = [
    {
      error: new AuthClientUnauthorizedRequestError(),
      status: 401,
      code: 'invalid_client'
    },
    {
      error: new AuthClientGrantNotFoundError(),
      status: 404,
      code: 'invalid_request'
    },
    {
      error: new AuthClientInvalidContinuationError(),
      status: 401,
      code: 'invalid_continuation'
    },
    {
      error: new AuthClientContinuationTooFastError(),
      status: 400,
      code: 'too_fast'
    },
    {
      error: new AuthClientInvalidInteractionError(),
      status: 404,
      code: 'invalid_continuation'
    },
    {
      error: new AuthClientInvalidGrantError(),
      status: 401,
      code: 'request_denied'
    },
    {
      error: new AuthClientInvalidGrantInputError(),
      status: 500,
      code: 'request_denied'
    }
  ];

  for (const errorCase of cases) {
    test(`answers ${errorCase.status} ${errorCase.code} for ${errorCase.error.name}`, () =>
      assertErrorResponse(continueRequest('POST'), errorCase));
  }
});

describe('revokeGrant', () => {
  const cases: ErrorCase[] = [
    {
      error: new AuthClientUnauthorizedRequestError(),
      status: 401,
      code: 'invalid_client'
    },
    {
      error: new AuthClientGrantNotFoundError(),
      status: 404,
      code: 'invalid_request'
    },
    {
      error: new AuthClientInvalidContinuationError(),
      status: 401,
      code: 'invalid_continuation'
    },
    {
      error: new AuthClientInvalidGrantError(),
      status: 404,
      code: 'invalid_request'
    },
    {
      error: new AuthClientContinuationTooFastError(),
      status: 500,
      code: 'request_denied'
    }
  ];

  for (const errorCase of cases) {
    test(`answers ${errorCase.status} ${errorCase.code} for ${errorCase.error.name}`, () =>
      assertErrorResponse(continueRequest('DELETE'), errorCase));
  }
});

describe('continue wait', () => {
  const WAIT_SECONDS = 5;
  const access = [{ type: 'INCOMING_PAYMENT', actions: ['CREATE'] }];
  const baseResult = {
    id: 'grant-1',
    continueId: 'continue-1',
    continueToken: 'continue-token',
    access: [],
    subjectIds: [],
    continueWaitSeconds: WAIT_SECONDS
  };
  const accessTokenResult = {
    accessTokenValue: 'token-value',
    accessTokenManagementId: 'token-management-id',
    accessTokenExpiresIn: 600,
    access
  };

  async function setupWithResult(result: object) {
    const app = Fastify();
    app.setValidatorCompiler(() => () => true);
    app.setErrorHandler(createErrorHandler(new NullLogger()));
    await app.register(grantRoutes, {
      authClient: {
        createGrant: async () => result,
        continueGrant: async () => result
      } as unknown as AuthClient,
      openPaymentsAuthServerUrl: AUTH_SERVER_URL
    });
    return app;
  }

  test('is returned for an interactive grant', async () => {
    const app = await setupWithResult({
      ...baseResult,
      interactionNonce: 'nonce'
    });

    const response = await app.inject(createGrantRequest());

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().continue.wait, WAIT_SECONDS);
  });

  test('is not returned for a grant that issues an access token', async () => {
    const app = await setupWithResult({ ...baseResult, ...accessTokenResult });

    const response = await app.inject(createGrantRequest());

    assert.equal(response.statusCode, 200);
    assert.ok(response.json().access_token);
    assert.equal(response.json().continue.wait, undefined);
  });

  test('is returned when polling a pending grant', async () => {
    const app = await setupWithResult(baseResult);

    const response = await app.inject(continueRequest('POST'));

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().access_token, undefined);
    assert.equal(response.json().continue.wait, WAIT_SECONDS);
  });

  test('is not returned when continuing issues an access token', async () => {
    const app = await setupWithResult({ ...baseResult, ...accessTokenResult });

    const response = await app.inject(continueRequest('POST'));

    assert.equal(response.statusCode, 200);
    assert.ok(response.json().access_token);
    assert.equal(response.json().continue.wait, undefined);
  });
});
