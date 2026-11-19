import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {
  AccessItem,
  AuthClient,
  AuthClientPermissionDeniedError,
  AuthClientUnknownError
} from 'auth-client-lib';
import {
  AccessType,
  assertGrantIdentifierMatches,
  decodeAccessTokenValue,
  introspectToken,
  RequestAction,
  TokenIntrospectionOptions
} from '../src/auth';
import { createErrorHandler } from '../src/errors';
import { NullLogger } from 'common-types-lib';
import {
  activeResult,
  GRANT_ID,
  IntrospectCall,
  RAW_TOKEN,
  signedAuthHeaders,
  stubAuthClient,
  TOKEN
} from './helpers';

const AUTH_SERVER_URL = 'https://auth.example';

async function createTestApp(
  authClient: AuthClient,
  opts: Partial<TokenIntrospectionOptions> & {
    identifierFromBody?: boolean;
  } = {}
) {
  const { identifierFromBody, ...introspectOpts } = opts;
  const app = Fastify();
  app.setErrorHandler(createErrorHandler(new NullLogger()));
  app.decorateRequest('grantAccess', null);
  app.post<{ Body: { walletAddress?: string } }>(
    '/things',
    {
      preHandler: (request, reply) =>
        introspectToken(request, reply, {
          authClient,
          authServerUrl: AUTH_SERVER_URL,
          type: AccessType.IncomingPayment,
          action: RequestAction.Create,
          ...(identifierFromBody
            ? {
                identifier: request.body.walletAddress
              }
            : {}),
          ...introspectOpts
        })
    },
    async (request) => ({ grantAccess: request.grantAccess })
  );
  return app;
}

const readItem: AccessItem = {
  type: 'INCOMING_PAYMENT',
  actions: ['CREATE', 'READ']
};

describe('decodeAccessTokenValue', () => {
  test('splits a compound token into grant id and raw token', () => {
    assert.deepEqual(decodeAccessTokenValue(TOKEN), {
      grantId: GRANT_ID,
      tokenValue: RAW_TOKEN
    });
  });

  test('returns undefined for a value that is not a compound token', () => {
    assert.equal(decodeAccessTokenValue('not-a-compound-token'), undefined);
  });
});

describe('introspectToken', () => {
  async function expectError(
    app: Awaited<ReturnType<typeof createTestApp>>,
    headers: Record<string, string>,
    status: number,
    description: string,
    code: string
  ) {
    const response = await app.inject({
      method: 'POST',
      url: '/things',
      headers,
      payload: {}
    });
    assert.equal(response.statusCode, status);
    assert.equal(response.json().error.description, description);
    assert.equal(response.json().error.code, code);
    assert.equal(
      response.headers['www-authenticate'],
      `GNAP as_uri=${AUTH_SERVER_URL}`
    );
  }

  test('401 without an authorization header', async () => {
    const calls: IntrospectCall[] = [];
    const app = await createTestApp(
      stubAuthClient(activeResult([readItem]), calls)
    );
    const { signature, 'signature-input': signatureInput } =
      signedAuthHeaders();
    const headers = { signature, 'signature-input': signatureInput };

    await expectError(
      app,
      headers,
      401,
      'Missing or invalid authorization header value',
      'invalid_token'
    );
    assert.equal(calls.length, 0);
  });

  test('401 for a non-GNAP authorization header', async () => {
    const app = await createTestApp(stubAuthClient(activeResult([readItem])));

    await expectError(
      app,
      { ...signedAuthHeaders(), authorization: `Bearer ${TOKEN}` },
      401,
      'Missing or invalid authorization header value',
      'invalid_token'
    );
  });

  test('401 without a signature header', async () => {
    const app = await createTestApp(stubAuthClient(activeResult([readItem])));
    const { authorization, 'signature-input': signatureInput } =
      signedAuthHeaders();
    const headers = { authorization, 'signature-input': signatureInput };

    await expectError(
      app,
      headers,
      401,
      'Missing signature header',
      'invalid_signature'
    );
  });

  test('401 without a signature-input header', async () => {
    const app = await createTestApp(stubAuthClient(activeResult([readItem])));
    const { authorization, signature } = signedAuthHeaders();
    const headers = { authorization, signature };

    await expectError(
      app,
      headers,
      401,
      'Missing signature-input header',
      'invalid_signature'
    );
  });

  test('401 when the token does not decode to a grant id', async () => {
    const calls: IntrospectCall[] = [];
    const app = await createTestApp(
      stubAuthClient(activeResult([readItem]), calls)
    );

    await expectError(
      app,
      signedAuthHeaders('garbage'),
      401,
      'Invalid Token',
      'invalid_token'
    );
    assert.equal(calls.length, 0);
  });

  test('401 when the Auth BC rejects the signature', async () => {
    const app = await createTestApp(
      stubAuthClient(new AuthClientPermissionDeniedError('denied'))
    );

    await expectError(
      app,
      signedAuthHeaders(),
      401,
      'Invalid signature',
      'invalid_signature'
    );
  });

  test('403 for an inactive token', async () => {
    const app = await createTestApp(
      stubAuthClient({ active: false, grantId: GRANT_ID, access: [] })
    );

    await expectError(
      app,
      signedAuthHeaders(),
      403,
      'Inactive Token',
      'inactive_token'
    );
  });

  test('403 when the grant has no matching access', async () => {
    const app = await createTestApp(stubAuthClient(activeResult([])));

    await expectError(
      app,
      signedAuthHeaders(),
      403,
      'Insufficient Grant',
      'insufficient_grant'
    );
  });

  test('500 when introspection fails unexpectedly', async () => {
    const app = await createTestApp(
      stubAuthClient(new AuthClientUnknownError('unexpected'))
    );

    const response = await app.inject({
      method: 'POST',
      url: '/things',
      headers: signedAuthHeaders(),
      payload: {}
    });
    assert.equal(response.statusCode, 500);
  });

  test('introspects the requested access with signature data and sets the matched access item', async () => {
    const calls: IntrospectCall[] = [];
    const app = await createTestApp(
      stubAuthClient(activeResult([readItem]), calls),
      {
        identifierFromBody: true
      }
    );

    const response = await app.inject({
      method: 'POST',
      url: '/things',
      headers: { ...signedAuthHeaders(), host: 'op.example' },
      payload: { walletAddress: 'https://op.example/alice' }
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().grantAccess, readItem);

    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.equal(call.grantId, GRANT_ID);
    assert.equal(call.tokenValue, RAW_TOKEN);
    assert.deepEqual(call.access, [
      {
        type: 'INCOMING_PAYMENT',
        actions: ['CREATE'],
        identifier: 'https://op.example/alice'
      }
    ]);
    assert.equal(call.signatureData.kid, 'key-1');
    assert.equal(call.signatureData.method, 'POST');
    assert.equal(call.signatureData.url, 'http://op.example/things');
    assert.equal(
      call.signatureData.body,
      JSON.stringify({ walletAddress: 'https://op.example/alice' })
    );
    assert.equal(call.signatureData.headers['authorization'], `GNAP ${TOKEN}`);
  });

  test('omits the identifier when none is known for the request', async () => {
    const calls: IntrospectCall[] = [];
    const app = await createTestApp(
      stubAuthClient(activeResult([readItem]), calls)
    );

    await app.inject({
      method: 'POST',
      url: '/things',
      headers: signedAuthHeaders(),
      payload: {}
    });

    assert.deepEqual(calls[0].access, [
      { type: 'INCOMING_PAYMENT', actions: ['CREATE'] }
    ]);
  });
});

describe('assertGrantIdentifierMatches', () => {
  const requestWith = (grantAccess: AccessItem | null) =>
    ({ grantAccess }) as unknown as Parameters<
      typeof assertGrantIdentifierMatches
    >[0];

  test('passes when the wallet address path matches the grant identifier', () => {
    assert.doesNotThrow(() =>
      assertGrantIdentifierMatches(
        requestWith({ ...readItem, identifier: 'https://op.example/alice' }),
        'alice'
      )
    );
  });

  test('throws 403 when the wallet address differs from the grant identifier', () => {
    assert.throws(
      () =>
        assertGrantIdentifierMatches(
          requestWith({ ...readItem, identifier: 'https://op.example/alice' }),
          'https://op.example/bob'
        ),
      (err: { status: number; message: string }) =>
        err.status === 403 && err.message === 'Insufficient Grant'
    );
  });

  test('passes when the grant access has no identifier', () => {
    assert.doesNotThrow(() =>
      assertGrantIdentifierMatches(requestWith(readItem), 'bob')
    );
  });

  test('passes for unauthenticated requests', () => {
    assert.doesNotThrow(() =>
      assertGrantIdentifierMatches(requestWith(null), 'bob')
    );
  });
});
