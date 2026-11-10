import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { AuthClient, SignatureRequestData } from 'auth-client-lib';
import { tokenRoutes } from '../src/routes/token';
import { errorHandler } from '../src/errors';
import { createAccessTokenResponse } from '../src/utils';

const AUTH_SERVER_URL = 'https://auth.example';
const GRANT_ID = 'grant-1';
const RAW_TOKEN = 'A1B2C3D4E5F60718293A';
const MANAGEMENT_ID = 'mgmt-1';

type TokenCall = {
  grantId: string;
  tokenValue: string;
  managementId: string;
};

/** Records the arguments the routes pass to the auth client. */
function authClient(calls: { rotate: TokenCall[]; revoke: TokenCall[] }) {
  return {
    rotateToken: async (
      grantId: string,
      _signatureData: SignatureRequestData,
      tokenValue: string,
      managementId: string
    ) => {
      calls.rotate.push({ grantId, tokenValue, managementId });
      return {
        grantId,
        newAccessTokenValue: 'F0E1D2C3B4A596877869',
        newAccessTokenManagementId: 'mgmt-2',
        newAccessTokenExpiresIn: 600,
        access: []
      };
    },
    revokeToken: async (
      grantId: string,
      _signatureData: SignatureRequestData,
      tokenValue: string,
      managementId: string
    ) => {
      calls.revoke.push({ grantId, tokenValue, managementId });
      return { id: grantId };
    }
  } as unknown as AuthClient;
}

async function setup() {
  const calls = { rotate: [] as TokenCall[], revoke: [] as TokenCall[] };
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(tokenRoutes, {
    authClient: authClient(calls),
    openPaymentsAuthServerUrl: AUTH_SERVER_URL
  });
  return { app, calls };
}

/** The access token exactly as a grant response hands it to the client. */
function issuedToken(grantId = GRANT_ID) {
  return createAccessTokenResponse({
    grantId,
    accessTokenValue: RAW_TOKEN,
    accessTokenManagementId: MANAGEMENT_ID,
    accessTokenExpiresIn: 600,
    access: [],
    openPaymentsAuthServerUrl: AUTH_SERVER_URL
  });
}

function tokenRequest(
  method: 'POST' | 'DELETE',
  manage: string,
  tokenValue: string
) {
  return {
    method,
    url: new URL(manage).pathname,
    headers: {
      authorization: `GNAP ${tokenValue}`,
      signature: 'sig1=:c2lnbmF0dXJl:',
      'signature-input': 'sig1=("@method" "@target-uri");keyid="key-1"'
    }
  };
}

describe('POST /token/:id', () => {
  test('rotates the token by its raw value', async () => {
    const { app, calls } = await setup();
    const token = issuedToken();

    const response = await app.inject(
      tokenRequest('POST', token.manage, token.value)
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(calls.rotate, [
      {
        grantId: GRANT_ID,
        tokenValue: RAW_TOKEN,
        managementId: MANAGEMENT_ID
      }
    ]);
    const rotated = response.json().access_token;
    assert.notEqual(rotated.value, token.value);
    assert.ok(rotated.manage.startsWith(`${AUTH_SERVER_URL}/token/`));
  });

  test('rejects a token issued for another grant', async () => {
    const { app, calls } = await setup();
    const token = issuedToken();
    const otherGrantToken = issuedToken('grant-2');

    const response = await app.inject(
      tokenRequest('POST', token.manage, otherGrantToken.value)
    );

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, 'invalid_client');
    assert.equal(calls.rotate.length, 0);
  });

  test('rejects a token that is not a compound value', async () => {
    const { app, calls } = await setup();
    const token = issuedToken();

    const response = await app.inject(
      tokenRequest('POST', token.manage, RAW_TOKEN)
    );

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, 'invalid_client');
    assert.equal(calls.rotate.length, 0);
  });
});

describe('DELETE /token/:id', () => {
  test('revokes the token by its raw value', async () => {
    const { app, calls } = await setup();
    const token = issuedToken();

    const response = await app.inject(
      tokenRequest('DELETE', token.manage, token.value)
    );

    assert.equal(response.statusCode, 204);
    assert.deepEqual(calls.revoke, [
      {
        grantId: GRANT_ID,
        tokenValue: RAW_TOKEN,
        managementId: MANAGEMENT_ID
      }
    ]);
  });

  test('rejects a token issued for another grant', async () => {
    const { app, calls } = await setup();
    const token = issuedToken();
    const otherGrantToken = issuedToken('grant-2');

    const response = await app.inject(
      tokenRequest('DELETE', token.manage, otherGrantToken.value)
    );

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, 'invalid_client');
    assert.equal(calls.revoke.length, 0);
  });

  test('rejects a token that is not a compound value', async () => {
    const { app, calls } = await setup();
    const token = issuedToken();

    const response = await app.inject(
      tokenRequest('DELETE', token.manage, RAW_TOKEN)
    );

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, 'invalid_client');
    assert.equal(calls.revoke.length, 0);
  });
});
