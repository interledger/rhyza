import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { GrantEntity, CreateGrantInput } from '../src/grant/entity';
import {
  AccessAction,
  AccessType,
  IFinishMethod
} from '../src/grant/interfaces';

function makeCreateGrantInput(
  overrides: Partial<CreateGrantInput> = {}
): CreateGrantInput {
  return {
    id: randomUUID(),
    startMethods: [],
    client: 'https://wallet.example/alice',
    accesses: [
      { type: AccessType.INCOMING_PAYMENT, actions: [AccessAction.READ] }
    ],
    ...overrides
  };
}

describe('GrantEntity', () => {
  describe('create', () => {
    it('finalizes the grant and issues an access token if the grant is non-interactive', () => {
      const id = randomUUID();
      const client = 'https://wallet.example/alice';
      const subjectIds = [{ format: 'email', id: 'alice@example.com' }];
      const accesses = [
        { type: AccessType.INCOMING_PAYMENT, actions: [AccessAction.READ] }
      ];
      const finishUri = 'https://client.example/finish';
      const input = makeCreateGrantInput({
        id,
        client,
        subjectIds,
        accesses,
        finishUri
      });

      const { entity, accessToken } = GrantEntity.create(input);

      assert.equal(entity.state, 'FINALIZED');
      assert.equal(entity.finalizationReason, 'ISSUED');
      assert.equal(entity.continueToken, undefined);
      assert.equal(entity.continueId, undefined);

      assert.equal(entity.interactionNonce, undefined);
      assert.equal(entity.interaction, undefined);

      assert.ok(accessToken);
      assert.ok(accessToken.value);
      assert.ok(accessToken.managementId);
      assert.equal(accessToken.expiresInMs, 10_000); // Default access token expiry
      assert.ok(accessToken.createdAt instanceof Date);

      assert.equal(entity.accessTokens.length, 1);
      assert.equal(
        entity.accessTokens.find(
          (entityAccessToken) => entityAccessToken.value === accessToken.value
        ),
        accessToken
      );

      // Input fields are carried onto the created entity.
      assert.equal(entity.client, client);
      assert.deepEqual(entity.subjectIds, subjectIds);
      assert.deepEqual(entity.accesses, accesses);
      assert.deepEqual(entity.startMethods, []);
      const obj = entity.toObject();
      assert.equal(obj.id, id);
      assert.equal(obj.finishUri, finishUri);
    });

    it('leaves the grant in pending state without an access token and creates continuation information for interactive grants', () => {
      const id = randomUUID();
      const client = 'https://wallet.example/alice';
      const subjectIds = [{ format: 'email', id: 'alice@example.com' }];
      const accesses = [
        {
          type: AccessType.OUTGOING_PAYMENT,
          actions: [AccessAction.CREATE]
        }
      ];
      const finishUri = 'https://client.example/finish';
      const finishMethod = IFinishMethod.REDIRECT;
      const finishNonce = randomUUID();
      const input = makeCreateGrantInput({
        id,
        client,
        subjectIds,
        accesses,
        finishUri,
        finishMethod,
        finishNonce,
        startMethods: ['REDIRECT']
      });

      const { entity, accessToken } = GrantEntity.create(input);

      assert.equal(entity.state, 'PENDING');
      assert.equal(entity.finalizationReason, undefined);
      assert.ok(entity.continueToken);
      assert.ok(entity.continueId);

      assert.ok(entity.interactionNonce);
      assert.equal(entity.interaction, undefined); // This should not be initalized until startInteraction is called on the entity.

      assert.equal(accessToken, undefined);
      assert.equal(entity.accessTokens.length, 0);

      // Input fields are carried onto the created entity.
      assert.equal(entity.client, client);
      assert.deepEqual(entity.subjectIds, subjectIds);
      assert.deepEqual(entity.accesses, accesses);
      assert.deepEqual(entity.startMethods, ['REDIRECT']);
      const obj = entity.toObject();
      assert.equal(obj.id, id);
      assert.equal(obj.finishUri, finishUri);
      assert.equal(obj.finishMethod, finishMethod);
      assert.equal(obj.finishNonce, finishNonce);
    });

    it('treats the grant as continuable if any requested access is interactive', () => {
      const input = makeCreateGrantInput({
        startMethods: ['REDIRECT'],
        accesses: [
          { type: AccessType.INCOMING_PAYMENT, actions: [AccessAction.READ] },
          {
            type: AccessType.OUTGOING_PAYMENT,
            actions: [AccessAction.CREATE]
          }
        ]
      });
      const { entity, accessToken } = GrantEntity.create(input);

      assert.equal(entity.state, 'PENDING');
      assert.ok(entity.continueToken);
      assert.ok(entity.continueId);
      assert.ok(entity.interactionNonce);
      assert.equal(entity.interaction, undefined); // This should not be initialized at this point.
      assert.equal(accessToken, undefined);
    });
  });
});
