import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import {
  AuthClient,
  AuthClientGrantNotFoundError,
  AuthClientInvalidContinuationError,
  AuthClientInvalidGrantError,
  AuthClientInvalidInteractionError,
  AuthClientUnknownInteractionError
} from 'auth-client-lib';
import { createErrorHandler } from '../src/errors';
import { NullLogger } from 'common-types-lib';
import { interactionRoutes } from '../src/routes/interaction';
import { createInteractResponse } from '../src/utils';

const AUTH_SERVER_URL = 'https://auth.example';
const IDP_URL = 'https://idp.example/consent';
const GRANT_ID = '6a1f2c3d-0000-4000-8000-000000000001';

describe('interact.redirect', () => {
  let app: FastifyInstance;
  const startedFor: string[] = [];

  before(async () => {
    app = Fastify();
    // same session setup as service.ts
    app.register(fastifyCookie);
    app.register(fastifySession, {
      cookieName: 'interactionSessionId',
      secret: 'a-test-secret-that-is-at-least-32-characters',
      cookie: { secure: false }
    });
    await app.register(interactionRoutes, {
      authClient: {
        startInteraction: async (grantId: string) => {
          startedFor.push(grantId);
          return {
            id: grantId,
            nonce: 'nonce-1',
            clientUri: 'https://client.example',
            clientName: 'Client'
          };
        }
      } as unknown as AuthClient,
      openPaymentsAuthServerUrl: AUTH_SERVER_URL,
      idpUrl: IDP_URL
    });
  });

  test('points to the interaction start route for the grant', () => {
    const { redirect } = createInteractResponse(
      GRANT_ID,
      'interaction-nonce',
      AUTH_SERVER_URL
    );

    assert.equal(redirect, `${AUTH_SERVER_URL}/interaction/${GRANT_ID}/start`);
  });

  test('is served by the auth server and starts the interaction', async () => {
    const { redirect } = createInteractResponse(
      GRANT_ID,
      'interaction-nonce',
      AUTH_SERVER_URL
    );

    const response = await app.inject({
      method: 'GET',
      url: new URL(redirect).pathname
    });

    assert.equal(response.statusCode, 302);
    assert.deepEqual(startedFor, [GRANT_ID]);
    const location = new URL(response.headers.location as string);
    assert.equal(`${location.origin}${location.pathname}`, IDP_URL);
    assert.equal(location.searchParams.get('interactId'), GRANT_ID);
  });
});

interface ErrorCase {
  error: Error;
  status: number;
  code: string;
}

/**
 * The interaction routes with an auth client that can start an interaction
 * (so finish has a session) but fails the call under test.
 */
async function interactionApp(failing: {
  startInteraction?: Error;
  finishInteraction?: Error;
}) {
  const app = Fastify();
  app.setErrorHandler(createErrorHandler(new NullLogger()));
  app.register(fastifyCookie);
  app.register(fastifySession, {
    cookieName: 'interactionSessionId',
    secret: 'a-test-secret-that-is-at-least-32-characters',
    cookie: { secure: false }
  });
  await app.register(interactionRoutes, {
    authClient: {
      startInteraction: async (grantId: string) => {
        if (failing.startInteraction) throw failing.startInteraction;
        return {
          id: grantId,
          nonce: 'nonce-1',
          clientUri: 'https://client.example',
          clientName: 'Client'
        };
      },
      getGrant: async () => ({ interactionNonce: 'nonce-1' }),
      finishInteraction: async () => {
        throw failing.finishInteraction;
      }
    } as unknown as AuthClient,
    openPaymentsAuthServerUrl: AUTH_SERVER_URL,
    idpUrl: IDP_URL
  });
  return app;
}

describe('interaction start errors', () => {
  const cases: ErrorCase[] = [
    {
      error: new AuthClientGrantNotFoundError(),
      status: 400,
      code: 'unknown_interaction'
    },
    {
      error: new AuthClientInvalidInteractionError(),
      status: 403,
      code: 'invalid_interaction'
    },
    {
      error: new AuthClientInvalidGrantError(),
      status: 403,
      code: 'invalid_interaction'
    },
    {
      error: new AuthClientInvalidContinuationError(),
      status: 500,
      code: 'request_denied'
    }
  ];

  for (const { error, status, code } of cases) {
    test(`answers ${status} ${code} for ${error.name}`, async () => {
      const app = await interactionApp({ startInteraction: error });

      const response = await app.inject({
        method: 'GET',
        url: `/interaction/${GRANT_ID}/start`
      });

      assert.equal(response.statusCode, status);
      assert.equal(response.json().error.code, code);
    });
  }
});

describe('interaction finish errors', () => {
  const cases: ErrorCase[] = [
    {
      error: new AuthClientGrantNotFoundError(),
      status: 404,
      code: 'unknown_interaction'
    },
    {
      error: new AuthClientUnknownInteractionError(),
      status: 404,
      code: 'unknown_interaction'
    },
    {
      error: new AuthClientInvalidInteractionError(),
      status: 401,
      code: 'invalid_interaction'
    },
    {
      error: new AuthClientInvalidGrantError(),
      status: 401,
      code: 'invalid_interaction'
    },
    {
      error: new AuthClientInvalidContinuationError(),
      status: 500,
      code: 'request_denied'
    }
  ];

  for (const { error, status, code } of cases) {
    test(`answers ${status} ${code} for ${error.name}`, async () => {
      const app = await interactionApp({ finishInteraction: error });
      const start = await app.inject({
        method: 'GET',
        url: `/interaction/${GRANT_ID}/start`
      });
      const cookie = start.headers['set-cookie'];

      const response = await app.inject({
        method: 'POST',
        url: `/interaction/${GRANT_ID}/finish`,
        headers: { cookie: Array.isArray(cookie) ? cookie[0] : cookie }
      });

      assert.equal(response.statusCode, status);
      assert.equal(response.json().error.code, code);
    });
  }
});
