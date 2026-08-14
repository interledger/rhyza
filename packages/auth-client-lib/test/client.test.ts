'use strict';

import { after, before, describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as grpc from '@grpc/grpc-js';
import { ServiceError } from '@grpc/grpc-js';
import {
  createHeaders,
  generateTestKeys
} from '@interledger/http-signature-utils';
import { AuthClient } from '../src/client';
import {
  AccessItem,
  GrantRequestFinish,
  SubjectId
} from 'auth-public-types-lib';

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
    overrides: { type?: string; actions?: string[] } = {}
  ): AccessItem {
    const item = new AccessItem();
    item.setType(overrides.type ?? 'INCOMING_PAYMENT');
    item.setActionsList(overrides.actions ?? ['READ']);
    return item;
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

      const subjectId = new SubjectId();
      subjectId.setFormat('email');
      subjectId.setId('alice@example.com');

      const access = makeAccessItem({
        type: 'INCOMING_PAYMENT',
        actions: ['CREATE']
      });
      const result = await authClient.createGrant(
        JSON.stringify(keys.publicKey),
        signatureData,
        {
          access: [access],
          subjectIds: [subjectId]
        }
      );

      assert.ok(result);
      assert.ok(result.getAccessTokenValue());
      assert.ok(result.getAccessTokenManagementId);
      assert.ok(result.getAccessTokenExpiresIn());
      assert.equal(result.getContinueId(), '');
      assert.equal(result.getContinueToken(), '');
      assert.equal(result.getInteractionNonce(), '');
      assert.deepStrictEqual(
        result.getAccessList().map((a) => a.toObject()),
        [access].map((a) => a.toObject())
      );
      assert.deepStrictEqual(
        result.getSubIdsList().map((s) => s.toObject()),
        [subjectId].map((s) => s.toObject())
      );
    });

    test('create interactive grant', async () => {
      const keys = generateTestKeys();
      const signatureData = await signedSignatureData(
        keys.privateKey,
        keys.publicKey.kid
      );

      const finish = new GrantRequestFinish();
      finish.setFinish('REDIRECT');
      finish.setUri('https://client.example/finish');
      finish.setNonce('finish-nonce');

      const access = [
        makeAccessItem({ type: 'OUTGOING_PAYMENT', actions: ['CREATE'] })
      ];

      const result = await authClient.createGrant(
        JSON.stringify(keys.publicKey),
        signatureData,
        {
          access,
          finish
        }
      );

      assert.ok(result);
      assert.ok(result.getContinueId());
      assert.ok(result.getContinueToken());
      assert.ok(result.getInteractionNonce());
      assert.equal(result.getAccessTokenValue(), '');
      assert.equal(result.getAccessTokenManagementId(), '');
      assert.equal(result.getAccessTokenExpiresIn(), 0);
      assert.deepStrictEqual(
        result.getAccessList().map((a) => a.toObject()),
        access.map((a) => a.toObject())
      );
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
            ]
          }
        );
        assert.fail('expected error for invalid signature');
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
        { access: [access] }
      );

      const result = await authClient.getGrant(createResult.getId());

      assert.ok(result);
      assert.equal(result.getId(), createResult.getId());
      assert.equal(result.getState(), 'FINALIZED');
      assert.equal(result.getClient(), JSON.stringify(keys.publicKey));
      assert.equal(result.getAccessesList().length, 1);
    });

    test('rejects with NOT_FOUND for an id that does not exist', async () => {
      try {
        await authClient.getGrant(randomUUID());
        assert.fail('expected error for an unknown grant id');
      } catch (e) {
        assert.ok(e instanceof Error);
        assert.equal((e as ServiceError).code, grpc.status.NOT_FOUND);
      }
    });
  });
});
