import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import { AuthClient } from 'auth-client-lib';
import { createInteractResponse } from '../src/utils';

const AUTH_SERVER_URL = 'https://auth.example';
const IDP_URL = 'https://idp.example/consent';
const GRANT_ID = '6a1f2c3d-0000-4000-8000-000000000001';

describe('interact.redirect', () => {
  let app: FastifyInstance;
  const startedFor: string[] = [];

  before(async () => {
    // interaction.ts reads IDP_URL when it is loaded
    process.env['IDP_URL'] = IDP_URL;
    const { interactionRoutes } = await import('../src/routes/interaction.js');

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
      openPaymentsAuthServerUrl: AUTH_SERVER_URL
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
