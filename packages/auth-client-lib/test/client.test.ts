'use strict';

import { after, before, describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  createHeaders,
  generateTestKeys
} from '@interledger/http-signature-utils';
import {
  AuthClient,
  AccessItem,
  GrantFinish,
  SubjectId,
  AccessLimits
} from '../src/';

describe('Auth Client', () => {
  const AUTH_GRPC_URL = process.env['AUTH_GRPC_URL'] || '0.0.0.0:50054';

  const REQUEST_URL = 'https://auth.example/create';
  const REQUEST_METHOD = 'POST';
  const REQUEST_BODY = '{}';

  async function signedSignatureData(
    privateKey: ReturnType<typeof generateTestKeys>['privateKey'],
    kid: string
  ) {
    const request = {
      url: REQUEST_URL,
      method: REQUEST_METHOD,
      body: REQUEST_BODY,
      headers: {} as Record<string, string>
    };
    const signatureHeaders = await createHeaders({
      request,
      privateKey,
      keyId: kid
    });
    const headers: Record<string, string> = {
      ...request.headers,
      ...signatureHeaders
    };
    return {
      url: REQUEST_URL,
      method: REQUEST_METHOD,
      body: REQUEST_BODY,
      headers: Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [
          key.toLowerCase(),
          value
        ])
      ) as Record<string, string>,
      kid
    };
  }

  function makeAccessItem(
    overrides: {
      type?: string;
      actions?: string[];
      limits?: AccessLimits;
      identifier?: string;
    } = {}
  ): AccessItem {
    return {
      type: 'INCOMING_PAYMENT',
      actions: ['READ'],
      ...overrides
    };
  }

  let authClient: AuthClient;

  before(async () => {
    authClient = new AuthClient(AUTH_GRPC_URL);
    await authClient.init();
  });

  after(async () => {
    await authClient.disconnect();
  });

  describe('createGrant', () => {
    test('create non-interactive grant', async () => {
      const keys = generateTestKeys();
      const signatureData = await signedSignatureData(
        keys.privateKey,
        keys.publicKey.kid
      );

      const subjectId: SubjectId = {
        format: 'uri',
        id: 'https://wallet.com/alice'
      };

      const access = makeAccessItem({
        type: 'INCOMING_PAYMENT',
        actions: ['CREATE']
      });
      const result = await authClient.createGrant(
        JSON.stringify(keys.publicKey),
        signatureData,
        {
          access: [access],
          subjectIds: [subjectId],
          start: ['redirect']
        }
      );

      assert.ok(result);
      assert.ok(result.accessTokenValue);
      assert.ok(result.accessTokenManagementId);
      assert.ok(result.accessTokenExpiresIn);
      assert.ok(result.continueId);
      assert.ok(result.continueToken);
      assert.equal(result.interactionNonce, undefined);
      assert.equal(result.continueId, '');
      assert.equal(result.continueToken, '');
      assert.deepStrictEqual(result.access, [access]);
      assert.deepStrictEqual(result.subjectIds, [subjectId]);
    });

    test('create interactive grant', async () => {
      const keys = generateTestKeys();
      const signatureData = await signedSignatureData(
        keys.privateKey,
        keys.publicKey.kid
      );

      const finish: GrantFinish = {
        method: 'REDIRECT',
        uri: 'https://client.example/finish',
        nonce: 'finish-nonce'
      };

      const access = [
        makeAccessItem({
          type: 'OUTGOING_PAYMENT',
          actions: ['CREATE'],
          limits: {
            debitAmount: {
              assetCode: 'USD',
              assetScale: 2,
              value: '100'
            }
          },
          identifier: 'https://wallet.com/alice'
        })
      ];

      const result = await authClient.createGrant(
        JSON.stringify(keys.publicKey),
        signatureData,
        {
          access,
          finish,
          start: ['redirect']
        }
      );

      assert.ok(result);
      assert.ok(result.continueId);
      assert.ok(result.continueToken);
      assert.equal(result.accessTokenValue, undefined);
      assert.equal(result.accessTokenManagementId, undefined);
      assert.equal(result.accessTokenExpiresIn, undefined);
      assert.deepStrictEqual(result.access, access);
    });

    test('invalid signature is rejected', async () => {
      const clientKeys = generateTestKeys();
      const signerKeys = generateTestKeys(); // a different, unrelated key
      const signatureData = await signedSignatureData(
        signerKeys.privateKey,
        clientKeys.publicKey.kid
      );

      try {
        await authClient.createGrant(
          JSON.stringify(clientKeys.publicKey),
          signatureData,
          {
            access: [
              makeAccessItem({ type: 'INCOMING_PAYMENT', actions: ['CREATE'] })
            ],
            start: ['redirect']
          }
        );
        assert.fail('expected error for invalid signature');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });
  });

  describe('rotateToken', () => {
    async function createIssuedGrant() {
      const keys = generateTestKeys();
      const signatureData = await signedSignatureData(
        keys.privateKey,
        keys.publicKey.kid
      );
      const access = makeAccessItem({
        type: 'INCOMING_PAYMENT',
        actions: ['READ']
      });
      const result = await authClient.createGrant(
        JSON.stringify(keys.publicKey),
        signatureData,
        { access: [access], start: ['redirect'] }
      );
      return {
        keys,
        grantId: result.id,
        tokenValue: result.accessTokenValue,
        managementId: result.accessTokenManagementId
      };
    }

    test('rotates a valid token and returns a new value and managementId', async () => {
      const { keys, grantId, tokenValue, managementId } =
        await createIssuedGrant();
      const signatureData = await signedSignatureData(
        keys.privateKey,
        keys.publicKey.kid
      );

      assert.ok(tokenValue);
      assert.ok(managementId);

      const result = await authClient.rotateToken(
        grantId,
        signatureData,
        tokenValue,
        managementId
      );

      assert.ok(result);
      assert.ok(result.newAccessTokenValue);
      assert.ok(result.newAccessTokenManagementId);
      assert.notEqual(result.newAccessTokenValue, tokenValue);
      assert.notEqual(result.newAccessTokenManagementId, managementId);
      assert.ok(result.newAccessTokenExpiresIn > 0);
    });

    test('rejects rotation with an invalid signature', async () => {
      const { grantId, tokenValue, managementId } = await createIssuedGrant();
      const wrongKeys = generateTestKeys();
      const signatureData = await signedSignatureData(
        wrongKeys.privateKey,
        wrongKeys.publicKey.kid
      );

      assert.ok(tokenValue);
      assert.ok(managementId);

      try {
        await authClient.rotateToken(
          grantId,
          signatureData,
          tokenValue,
          managementId
        );
        assert.fail('expected error for invalid signature');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });

    test('rejects rotation of an unknown token value', async () => {
      const { keys, grantId, managementId } = await createIssuedGrant();
      const signatureData = await signedSignatureData(
        keys.privateKey,
        keys.publicKey.kid
      );

      assert.ok(managementId);

      try {
        await authClient.rotateToken(
          grantId,
          signatureData,
          'unknown-token-value',
          managementId
        );
        assert.fail('expected error for unknown token');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });

    test('rejects replaying an already-rotated (revoked) token', async () => {
      const { keys, grantId, tokenValue, managementId } =
        await createIssuedGrant();
      const signatureData = await signedSignatureData(
        keys.privateKey,
        keys.publicKey.kid
      );

      assert.ok(tokenValue);
      assert.ok(managementId);

      // First rotation succeeds.
      await authClient.rotateToken(
        grantId,
        signatureData,
        tokenValue,
        managementId
      );

      // Replaying the old token must fail.
      try {
        await authClient.rotateToken(
          grantId,
          await signedSignatureData(keys.privateKey, keys.publicKey.kid),
          tokenValue,
          managementId
        );
        assert.fail('expected error replaying revoked token');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });
  });

  describe('revokeToken', () => {
    async function createIssuedGrant() {
      const keys = generateTestKeys();
      const signatureData = await signedSignatureData(
        keys.privateKey,
        keys.publicKey.kid
      );
      const access = makeAccessItem({
        type: 'INCOMING_PAYMENT',
        actions: ['READ']
      });
      const result = await authClient.createGrant(
        JSON.stringify(keys.publicKey),
        signatureData,
        { access: [access], start: ['redirect'] }
      );
      return {
        keys,
        grantId: result.id,
        tokenValue: result.accessTokenValue!,
        managementId: result.accessTokenManagementId!
      };
    }

    test('revokes a valid token', async () => {
      const { keys, grantId, tokenValue, managementId } =
        await createIssuedGrant();
      const access = [
        makeAccessItem({ type: 'INCOMING_PAYMENT', actions: ['READ'] })
      ];

      const before = await authClient.introspectToken(
        grantId,
        tokenValue,
        access
      );
      assert.equal(before.active, true);

      const signatureData = await signedSignatureData(
        keys.privateKey,
        keys.publicKey.kid
      );

      const result = await authClient.revokeToken(
        grantId,
        signatureData,
        tokenValue,
        managementId
      );

      assert.ok(result);
      assert.equal(result.id, grantId);

      const after = await authClient.introspectToken(
        grantId,
        tokenValue,
        access
      );
      assert.equal(after.active, false);
    });

    test('rejects revocation with an invalid signature', async () => {
      const { grantId, tokenValue, managementId } = await createIssuedGrant();
      const wrongKeys = generateTestKeys();
      const signatureData = await signedSignatureData(
        wrongKeys.privateKey,
        wrongKeys.publicKey.kid
      );

      try {
        await authClient.revokeToken(
          grantId,
          signatureData,
          tokenValue,
          managementId
        );
        assert.fail('expected error for invalid signature');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });

    test('rejects revocation of an unknown token value', async () => {
      const { keys, grantId, managementId } = await createIssuedGrant();
      const signatureData = await signedSignatureData(
        keys.privateKey,
        keys.publicKey.kid
      );

      try {
        await authClient.revokeToken(
          grantId,
          signatureData,
          'unknown-token-value',
          managementId
        );
        assert.fail('expected error for unknown token');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });

    test('rejects revocation with a mismatched managementId', async () => {
      const { keys, grantId, tokenValue } = await createIssuedGrant();
      const signatureData = await signedSignatureData(
        keys.privateKey,
        keys.publicKey.kid
      );

      try {
        await authClient.revokeToken(
          grantId,
          signatureData,
          tokenValue,
          'wrong-management-id'
        );
        assert.fail('expected error for mismatched managementId');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });
  });

  describe('continueGrant', () => {
    async function createInteractiveGrant(
      keys: ReturnType<typeof generateTestKeys>,
      options: { withFinish?: boolean } = {}
    ) {
      const signatureData = await signedSignatureData(
        keys.privateKey,
        keys.publicKey.kid
      );

      const createOptions: {
        access: AccessItem[];
        start: string[];
        finish?: GrantFinish;
      } = {
        access: [
          makeAccessItem({ type: 'OUTGOING_PAYMENT', actions: ['CREATE'] })
        ],
        start: ['redirect']
      };

      if (options.withFinish) {
        createOptions.finish = {
          uri: 'https://client.example/finish',
          nonce: 'finish-nonce',
          method: 'redirect'
        };
      }

      return authClient.createGrant(
        JSON.stringify(keys.publicKey),
        signatureData,
        createOptions
      );
    }

    test('continues pending grant and rotates continue token', async () => {
      const keys = generateTestKeys();
      const created = await createInteractiveGrant(keys);

      assert.ok(created.id);
      assert.ok(created.continueId);
      assert.ok(created.continueToken);

      // Continue tokens are inactive until the grant poll window elapses.
      await new Promise((resolve) => setTimeout(resolve, 5_100));

      const signatureData = await signedSignatureData(
        keys.privateKey,
        keys.publicKey.kid
      );

      const result = await authClient.continueGrant(
        created.id,
        signatureData,
        created.continueId,
        created.continueToken
      );

      assert.ok(result);
      assert.equal(result.id, created.id);
      assert.ok(result.continueId);
      assert.ok(result.continueToken);
      assert.notEqual(result.continueToken, created.continueToken);
      assert.notEqual(result.continueId, created.continueId);
      assert.equal(result.accessTokenValue, undefined);
      assert.equal(result.accessTokenManagementId, undefined);
      assert.equal(result.accessTokenExpiresIn, undefined);
    });

    test('rejects continue with invalid continue token', async () => {
      const keys = generateTestKeys();
      const created = await createInteractiveGrant(keys);
      const signatureData = await signedSignatureData(
        keys.privateKey,
        keys.publicKey.kid
      );

      try {
        await authClient.continueGrant(
          created.id,
          signatureData,
          created.continueId,
          'invalid-continue-token'
        );
        assert.fail('expected error for invalid continue token');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });

    test('rejects continue with invalid signature', async () => {
      const clientKeys = generateTestKeys();
      const created = await createInteractiveGrant(clientKeys);

      const signerKeys = generateTestKeys();
      const signatureData = await signedSignatureData(
        signerKeys.privateKey,
        clientKeys.publicKey.kid
      );

      try {
        await authClient.continueGrant(
          created.id,
          signatureData,
          created.continueId,
          created.continueToken
        );
        assert.fail('expected error for invalid signature');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });
  });

  describe('revokeGrant', () => {
    async function createInteractiveGrant() {
      const keys = generateTestKeys();
      const signatureData = await signedSignatureData(
        keys.privateKey,
        keys.publicKey.kid
      );
      const created = await authClient.createGrant(
        JSON.stringify(keys.publicKey),
        signatureData,
        {
          access: [
            makeAccessItem({ type: 'OUTGOING_PAYMENT', actions: ['CREATE'] })
          ]
        }
      );
      return { keys, created };
    }

    test('revokes a continuable grant and clears continue credentials', async () => {
      const { keys, created } = await createInteractiveGrant();
      assert.ok(created.continueId);
      assert.ok(created.continueToken);

      const signatureData = await signedSignatureData(
        keys.privateKey,
        keys.publicKey.kid
      );
      const result = await authClient.revokeGrant(
        created.id,
        signatureData,
        created.continueId,
        created.continueToken
      );

      assert.ok(result);
      assert.equal(result.id, created.id);

      const grant = await authClient.getGrant(created.id);
      assert.equal(grant.state, 'REVOKED');
      assert.ok(!grant.continueToken);
      assert.ok(!grant.continueId);
    });

    test('rejects revocation with an invalid continue token', async () => {
      const { keys, created } = await createInteractiveGrant();
      const signatureData = await signedSignatureData(
        keys.privateKey,
        keys.publicKey.kid
      );

      try {
        await authClient.revokeGrant(
          created.id,
          signatureData,
          created.continueId,
          'invalid-continue-token'
        );
        assert.fail('expected error for invalid continue token');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });

    test('rejects revocation with an invalid signature', async () => {
      const clientKeys = generateTestKeys();
      const created = await authClient.createGrant(
        JSON.stringify(clientKeys.publicKey),
        await signedSignatureData(
          clientKeys.privateKey,
          clientKeys.publicKey.kid
        ),
        {
          access: [
            makeAccessItem({ type: 'OUTGOING_PAYMENT', actions: ['CREATE'] })
          ]
        }
      );

      const signerKeys = generateTestKeys();
      const signatureData = await signedSignatureData(
        signerKeys.privateKey,
        clientKeys.publicKey.kid
      );

      try {
        await authClient.revokeGrant(
          created.id,
          signatureData,
          created.continueId,
          created.continueToken
        );
        assert.fail('expected error for invalid signature');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });

    test('rejects revoking an already-revoked grant', async () => {
      const { keys, created } = await createInteractiveGrant();
      const signatureData = await signedSignatureData(
        keys.privateKey,
        keys.publicKey.kid
      );

      await authClient.revokeGrant(
        created.id,
        signatureData,
        created.continueId,
        created.continueToken
      );

      try {
        await authClient.revokeGrant(
          created.id,
          await signedSignatureData(keys.privateKey, keys.publicKey.kid),
          created.continueId,
          created.continueToken
        );
        assert.fail('expected error revoking an already-revoked grant');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });
  });

  describe('getGrant', () => {
    test('returns the grant for an existing id', async () => {
      const keys = generateTestKeys();
      const signatureData = await signedSignatureData(
        keys.privateKey,
        keys.publicKey.kid
      );

      const access = makeAccessItem({
        type: 'INCOMING_PAYMENT',
        actions: ['READ']
      });
      const createResult = await authClient.createGrant(
        JSON.stringify(keys.publicKey),
        signatureData,
        { access: [access], start: ['redirect'] }
      );

      const result = await authClient.getGrant(createResult.id);

      assert.ok(result);
      assert.equal(result.id, createResult.id);
      assert.equal(result.state, 'ISSUED');
      assert.ok(result.continueToken);
      assert.ok(result.continueId);
      assert.equal(result.client, JSON.stringify(keys.publicKey));
      assert.equal(result.accesses.length, 1);
    });

    test('rejects with NOT_FOUND for an id that does not exist', async () => {
      try {
        await authClient.getGrant(randomUUID());
        assert.fail('expected error for an unknown grant id');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });
  });

  describe('introspectToken', () => {
    async function createIssuedGrant(
      access: AccessItem[]
    ): Promise<{ id: string; tokenValue: string }> {
      const keys = generateTestKeys();
      const signatureData = await signedSignatureData(
        keys.privateKey,
        keys.publicKey.kid
      );
      const createResult = await authClient.createGrant(
        JSON.stringify(keys.publicKey),
        signatureData,
        { access, start: ['redirect'] }
      );

      return {
        id: createResult.id,
        tokenValue: createResult.accessTokenValue as string
      };
    }

    test('returns active: true for a valid access token', async () => {
      const access = [
        makeAccessItem({ type: 'INCOMING_PAYMENT', actions: ['READ'] })
      ];
      const { id, tokenValue } = await createIssuedGrant(access);

      const result = await authClient.introspectToken(id, tokenValue, access);

      assert.equal(result.active, true);
      assert.equal(result.grantId, id);
      assert.deepStrictEqual(result.access, access);
    });

    test('returns active: false for a token value that does not match', async () => {
      const access = [
        makeAccessItem({ type: 'INCOMING_PAYMENT', actions: ['READ'] })
      ];
      const { id } = await createIssuedGrant(access);

      const result = await authClient.introspectToken(
        id,
        'unknown-token-value',
        []
      );

      assert.equal(result.active, false);
      assert.equal(result.access.length, 0);
    });

    test('restricts the returned access to the requested access items', async () => {
      const access = [
        makeAccessItem({ type: 'INCOMING_PAYMENT', actions: ['READ'] }),
        makeAccessItem({ type: 'QUOTE', actions: ['CREATE'] })
      ];
      const { id, tokenValue } = await createIssuedGrant(access);

      const result = await authClient.introspectToken(id, tokenValue, [
        access[0]
      ]);

      assert.equal(result.active, true);
      assert.deepStrictEqual(result.access, [access[0]]);
    });

    test('returns active: false when the requested access items are not fully covered by the grant', async () => {
      const access = [
        makeAccessItem({ type: 'INCOMING_PAYMENT', actions: ['READ'] })
      ];
      const { id, tokenValue } = await createIssuedGrant(access);

      const result = await authClient.introspectToken(id, tokenValue, [
        ...access,
        makeAccessItem({ type: 'QUOTE', actions: ['CREATE'] })
      ]);

      assert.equal(result.active, false);
    });

    test('returns active: false when the grant does not exist', async () => {
      const result = await authClient.introspectToken(
        randomUUID(),
        'some-token-value',
        []
      );

      assert.equal(result.active, false);
    });
  });
  describe('startInteraction', () => {
    async function createInteractiveGrant(): Promise<{
      id: string;
    }> {
      const keys = generateTestKeys();
      const signatureData = await signedSignatureData(
        keys.privateKey,
        keys.publicKey.kid
      );

      const grant = await authClient.createGrant(
        JSON.stringify(keys.publicKey),
        signatureData,
        {
          access: [
            makeAccessItem({ type: 'OUTGOING_PAYMENT', actions: ['CREATE'] })
          ],
          start: ['redirect']
        }
      );

      return {
        id: grant.id
      };
    }

    test('starts the interaction for a pending interactive grant', async () => {
      const { id } = await createInteractiveGrant();
      const result = await authClient.startInteraction(id);

      assert.ok(result);
      assert.equal(result.id, id);
    });

    test('unknown grant id is rejected', async () => {
      try {
        await authClient.startInteraction(randomUUID());
        assert.fail('expected error for unknown grant');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });
  });

  describe('finishInteraction', () => {
    const FINISH_NONCE = 'client-finish-nonce';

    async function createInteractiveGrant(): Promise<{ id: string }> {
      const keys = generateTestKeys();
      const signatureData = await signedSignatureData(
        keys.privateKey,
        keys.publicKey.kid
      );

      const grant = await authClient.createGrant(
        JSON.stringify(keys.publicKey),
        signatureData,
        {
          access: [
            makeAccessItem({ type: 'OUTGOING_PAYMENT', actions: ['CREATE'] })
          ],
          start: ['redirect'],
          finish: {
            method: 'redirect',
            uri: 'https://client.example/finish',
            nonce: FINISH_NONCE
          }
        }
      );

      return { id: grant.id };
    }

    async function startAndHandleInteraction(
      id: string,
      choice: 'accept' | 'reject'
    ): Promise<{ nonce: string }> {
      const { nonce } = await authClient.startInteraction(id);

      if (choice === 'accept') {
        await authClient.acceptInteraction(id, randomUUID(), nonce);
      } else {
        await authClient.rejectInteraction(id, nonce);
      }

      return { nonce };
    }

    test('finishes an accepted interaction and returns the interact and finish nonces', async () => {
      const { id } = await createInteractiveGrant();
      const { nonce } = await startAndHandleInteraction(id, 'accept');

      const result = await authClient.finishInteraction(id, nonce);

      assert.ok(result);
      assert.equal(result.id, id);
      assert.equal(result.interactNonce, nonce);
      assert.equal(result.clientNonce, FINISH_NONCE);
      assert.ok(result.interactRef);

      const grant = await authClient.getGrant(id);
      assert.equal(grant.state, 'APPROVED');
    });

    test('finishes a rejected interaction', async () => {
      const { id } = await createInteractiveGrant();
      const { nonce } = await startAndHandleInteraction(id, 'reject');

      const result = await authClient.finishInteraction(id, nonce);

      assert.ok(result);
      assert.equal(result.id, id);

      const grant = await authClient.getGrant(id);
      assert.equal(grant.state, 'REJECTED');
    });

    test('unknown grant id is rejected', async () => {
      try {
        await authClient.finishInteraction(randomUUID(), 'some-nonce');
        assert.fail('expected error for unknown grant');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });

    test('rejects finishing an interaction that has not yet been accepted or rejected', async () => {
      const { id } = await createInteractiveGrant();
      const { nonce } = await authClient.startInteraction(id);

      try {
        await authClient.finishInteraction(id, nonce);
        assert.fail('expected error for a still-pending interaction');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });

    test('rejects an incorrect nonce', async () => {
      const { id } = await createInteractiveGrant();
      await startAndHandleInteraction(id, 'accept');

      try {
        await authClient.finishInteraction(id, 'incorrect-nonce');
        assert.fail('expected error for incorrect nonce');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });

    test('rejects finishing an interaction that has already been finished', async () => {
      const { id } = await createInteractiveGrant();
      const { nonce } = await startAndHandleInteraction(id, 'accept');

      await authClient.finishInteraction(id, nonce);

      try {
        await authClient.finishInteraction(id, nonce);
        assert.fail('expected error for an already-finished interaction');
      } catch (e) {
        assert.ok(e instanceof Error);
      }
    });
  });
});
