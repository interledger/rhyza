import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { KeyObject, randomBytes, randomUUID } from 'node:crypto';
import { IMessage } from 'common-types-lib';
import {
  createHeaders,
  generateTestKeys
} from '@interledger/http-signature-utils';

import { GrantAggregate } from '../src/grant/aggregate';
import { GrantEntity } from '../src/grant/entity';
import {
  CreateGrantCmd,
  CreateGrantCmdPayload,
  IntrospectTokenCmd,
  IntrospectTokenCmdPayload,
  RevokeGrantCmd,
  RevokeTokenCmd,
  RotateTokenCmd,
  StartInteractionCmd,
  FinishInteractionCmd
} from '../src/commands';
import {
  GrantCreatedEvent,
  GrantCreateFailedEvent,
  GrantRevokedEvent,
  GrantRevokeFailedEvent,
  TokenIntrospectedEvent,
  TokenRevokedEvent,
  TokenRevokeFailedEvent,
  TokenRotatedEvent,
  TokenRotationFailedEvent,
  GrantInteractionStartedEvent,
  GrantInteractionStartFailedEvent,
  GrantInteractionFinishedEvent,
  GrantInteractionFinishFailedEvent
} from '../src/grant/events';
import {
  AccessAction,
  AccessType,
  GrantState,
  IGrant,
  InteractionState
} from '../src/grant/interfaces';
import { MockGrantRepo, MockWalletAddressService } from './mocks';
import { PinoLogger } from 'implementations-lib';

const REQUEST_URL = 'https://auth.example/create';
const REQUEST_METHOD = 'POST';
const REQUEST_BODY = '{}';

// Signs the fixed request url/method/body with the given key, returning the
// resulting headers lower-cased the way they'd arrive on an incoming request.
async function signRequest(
  privateKey: KeyObject,
  keyId: string
): Promise<Record<string, string>> {
  const request = {
    url: REQUEST_URL,
    method: REQUEST_METHOD,
    body: REQUEST_BODY,
    headers: {} as Record<string, string>
  };
  const signatureHeaders = await createHeaders({ request, privateKey, keyId });
  const headers = { ...request.headers, ...signatureHeaders };
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
}

async function signedSignatureData(
  privateKey: KeyObject,
  kid: string
): Promise<CreateGrantCmdPayload['signatureData']> {
  return {
    url: REQUEST_URL,
    method: REQUEST_METHOD,
    body: REQUEST_BODY,
    headers: await signRequest(privateKey, kid),
    kid
  };
}

function makeCreateGrantCmd(
  payload: Partial<CreateGrantCmdPayload> &
    Pick<CreateGrantCmdPayload, 'client' | 'signatureData'>,
  requestId: string = randomUUID()
): CreateGrantCmd {
  return new CreateGrantCmd(
    {
      id: randomUUID(),
      access: [
        { type: AccessType.INCOMING_PAYMENT, actions: [AccessAction.READ] }
      ],
      ...payload
    },
    requestId
  );
}

function makeIntrospectTokenCmd(
  payload: Partial<IntrospectTokenCmdPayload> &
    Pick<IntrospectTokenCmdPayload, 'id' | 'tokenValue'>,
  requestId: string = randomUUID()
): IntrospectTokenCmd {
  return new IntrospectTokenCmd(payload, requestId);
}

function generateNonce(): string {
  return randomBytes(16).toString('hex').toUpperCase();
}

describe('GrantAggregate.handleBatch', () => {
  let repo: MockGrantRepo;
  let walletAddressService: MockWalletAddressService;
  let aggregate: GrantAggregate;
  let logger: PinoLogger;

  beforeEach(() => {
    repo = new MockGrantRepo();
    logger = new PinoLogger();
    walletAddressService = new MockWalletAddressService();
    aggregate = new GrantAggregate(repo, walletAddressService, logger);
  });

  afterEach(() => {
    mock.restoreAll();
  });

  describe('handleBatch', async () => {
    async function createInteractiveGrant() {
      const keys = generateTestKeys();
      const createCmd = makeCreateGrantCmd({
        client: JSON.stringify(keys.publicKey),
        signatureData: await signedSignatureData(
          keys.privateKey,
          keys.publicKey.kid
        ),
        access: [
          {
            type: AccessType.OUTGOING_PAYMENT,
            actions: [AccessAction.CREATE]
          }
        ],
        interact: { start: ['REDIRECT'] }
      });
      const { events } = await aggregate.handleBatch([createCmd]);
      await aggregate.flush();

      assert.equal(events[0].msgName, GrantCreatedEvent.name);
      const payload = (events[0] as GrantCreatedEvent).payload;
      assert.ok(payload.continueToken);
      assert.ok(payload.continueId);

      return {
        keys,
        grantId: payload.id,
        continueToken: payload.continueToken!,
        continueId: payload.continueId!
      };
    }

    it('logs an error when it processes an unknown command', async () => {
      const errorMock = mock.method(logger, 'error', () => {});

      const unknownCmd: IMessage = {
        msgDataFormat: 'JSON',
        msgType: 'COMMAND',
        msgId: randomUUID(),
        msgName: 'SomeUnknownCommand',
        msgTimestamp: Date.now(),
        msgTopic: 'auth-commands',
        msgKey: null,
        msgPartition: null,
        msgOffset: null,
        msgBatchId: null,
        payload: {}
      };

      await assert.doesNotReject(() => aggregate.handleBatch([unknownCmd]));

      assert.equal(errorMock.mock.callCount(), 1);
      assert.equal(
        errorMock.mock.calls[0].arguments[0],
        `Received unexpected command: ${unknownCmd.msgName}`
      );
    });

    describe('handleCreateGrantCommand', async () => {
      it('creates a non-interactive grant and issues an access token', async () => {
        const keys = generateTestKeys();
        const cmd = makeCreateGrantCmd({
          client: JSON.stringify(keys.publicKey),
          signatureData: await signedSignatureData(
            keys.privateKey,
            keys.publicKey.kid
          )
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, GrantCreatedEvent.name);
        const payload = (events[0] as GrantCreatedEvent).payload;
        assert.equal(payload.id, cmd.payload.id);
        assert.ok(payload.accessTokenValue);
        assert.ok(payload.accessTokenManagementId);
        assert.equal(payload.accessTokenExpiresIn, 10_000);
        assert.ok(payload.continueId);
        assert.ok(payload.continueToken);
        assert.equal(payload.interactionNonce, undefined);
        assert.deepEqual(payload.access, cmd.payload.access);
      });

      it('creates an interactive grant pending continuation for OUTGOING_PAYMENT access', async () => {
        const keys = generateTestKeys();
        const cmd = makeCreateGrantCmd({
          client: JSON.stringify(keys.publicKey),
          signatureData: await signedSignatureData(
            keys.privateKey,
            keys.publicKey.kid
          ),
          access: [
            {
              type: AccessType.OUTGOING_PAYMENT,
              actions: [AccessAction.CREATE]
            }
          ],
          interact: { start: ['REDIRECT'] }
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, GrantCreatedEvent.name);
        const payload = (events[0] as GrantCreatedEvent).payload;
        assert.ok(payload.continueId);
        assert.ok(payload.continueToken);
        assert.ok(payload.interactionNonce);
        assert.equal(payload.accessTokenValue, undefined);
        assert.equal(payload.accessTokenValue, undefined);
        assert.equal(payload.accessTokenManagementId, undefined);
        assert.equal(payload.accessTokenExpiresIn, undefined);
      });

      describe('client key provided through directed identity', () => {
        it('creates the grant when the provided key successfully validates the signature', async () => {
          const clientKeys = generateTestKeys();
          const cmd = makeCreateGrantCmd({
            client: JSON.stringify(clientKeys.publicKey),
            signatureData: await signedSignatureData(
              clientKeys.privateKey,
              clientKeys.publicKey.kid
            )
          });
          const { events } = await aggregate.handleBatch([cmd]);

          assert.equal(events.length, 1);
          assert.equal(events[0].msgName, GrantCreatedEvent.name);
          const payload = (events[0] as GrantCreatedEvent).payload;
          assert.equal(payload.id, cmd.payload.id);
        });

        it('fails with UnauthorizedRequestError when the provided key does not validate the signature', async () => {
          const clientKeys = generateTestKeys();
          const signerKeys = generateTestKeys();
          const cmd = makeCreateGrantCmd({
            client: JSON.stringify(clientKeys.publicKey),
            signatureData: await signedSignatureData(
              signerKeys.privateKey,
              clientKeys.publicKey.kid
            )
          });
          const { events } = await aggregate.handleBatch([cmd]);

          assert.equal(events.length, 1);
          assert.equal(events[0].msgName, GrantCreateFailedEvent.name);
          const payload = (events[0] as GrantCreateFailedEvent).payload;
          assert.equal(payload.errorName, 'UnauthorizedRequestError');
          assert.equal(payload.grantId, cmd.payload.id);
        });
      });

      describe('client key resolved via wallet address lookup', () => {
        it('resolves the client key and creates the grant', async () => {
          const keys = generateTestKeys();
          const walletAddress = 'https://wallet.example/alice';
          const kid = 'wallet-key';
          walletAddressService.setKeys(walletAddress, [
            { ...keys.publicKey, kid }
          ]);

          const cmd = makeCreateGrantCmd({
            client: walletAddress,
            signatureData: await signedSignatureData(keys.privateKey, kid)
          });
          const { events } = await aggregate.handleBatch([cmd]);

          assert.equal(events.length, 1);
          assert.equal(events[0].msgName, GrantCreatedEvent.name);
          const payload = (events[0] as GrantCreatedEvent).payload;
          assert.equal(payload.id, cmd.payload.id);
        });

        it('fails with UnauthorizedRequestError when the wallet address has no matching key', async () => {
          const keys = generateTestKeys();
          const walletAddress = 'https://wallet.example/bob';
          walletAddressService.setKeys(walletAddress, [
            { ...keys.publicKey, kid: 'some-other-key' }
          ]);

          const cmd = makeCreateGrantCmd({
            client: walletAddress,
            signatureData: await signedSignatureData(
              keys.privateKey,
              'wallet-key'
            )
          });
          const { events } = await aggregate.handleBatch([cmd]);

          assert.equal(events.length, 1);
          assert.equal(events[0].msgName, GrantCreateFailedEvent.name);
          const payload = (events[0] as GrantCreateFailedEvent).payload;
          assert.equal(payload.errorName, 'UnauthorizedRequestError');
          assert.equal(payload.grantId, cmd.payload.id);
        });

        it('fails with UnauthorizedRequestError when the wallet address has no keys at all', async () => {
          const keys = generateTestKeys();
          const cmd = makeCreateGrantCmd({
            client: 'https://wallet.example/nokeys',
            signatureData: await signedSignatureData(
              keys.privateKey,
              'wallet-key'
            )
          });
          const { events } = await aggregate.handleBatch([cmd]);

          assert.equal(events.length, 1);
          assert.equal(events[0].msgName, GrantCreateFailedEvent.name);
          const payload = (events[0] as GrantCreateFailedEvent).payload;
          assert.equal(payload.errorName, 'UnauthorizedRequestError');
        });

        it('fails with UnauthorizedRequestError when the resolved key does not validate the signature', async () => {
          const signerKeys = generateTestKeys();
          const wrongKeys = generateTestKeys();
          const walletAddress = 'https://wallet.example/carol';
          const kid = 'wallet-key';
          walletAddressService.setKeys(walletAddress, [
            { ...wrongKeys.publicKey, kid }
          ]);

          const cmd = makeCreateGrantCmd({
            client: walletAddress,
            signatureData: await signedSignatureData(signerKeys.privateKey, kid)
          });
          const { events } = await aggregate.handleBatch([cmd]);

          assert.equal(events.length, 1);
          assert.equal(events[0].msgName, GrantCreateFailedEvent.name);
          const payload = (events[0] as GrantCreateFailedEvent).payload;
          assert.equal(payload.errorName, 'UnauthorizedRequestError');
          assert.equal(payload.grantId, cmd.payload.id);
        });
      });

      it('fails with DuplicateGrantError when a grant with the same id already exists', async () => {
        const keys = generateTestKeys();
        const id = randomUUID();

        await aggregate.handleBatch([
          makeCreateGrantCmd({
            id,
            client: JSON.stringify(keys.publicKey),
            signatureData: await signedSignatureData(
              keys.privateKey,
              keys.publicKey.kid
            )
          })
        ]);

        const { events } = await aggregate.handleBatch([
          makeCreateGrantCmd({
            id,
            client: JSON.stringify(keys.publicKey),
            signatureData: await signedSignatureData(
              keys.privateKey,
              keys.publicKey.kid
            )
          })
        ]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, GrantCreateFailedEvent.name);
        const payload = (events[0] as GrantCreateFailedEvent).payload;
        assert.equal(payload.errorName, 'DuplicateGrantError');
        assert.equal(payload.grantId, id);
      });

      it('carries subjectIds through to the created grant event', async () => {
        const keys = generateTestKeys();
        const subjectIds = [{ format: 'email', id: 'alice@example.com' }];
        const cmd = makeCreateGrantCmd({
          client: JSON.stringify(keys.publicKey),
          signatureData: await signedSignatureData(
            keys.privateKey,
            keys.publicKey.kid
          ),
          subjectIds
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events[0].msgName, GrantCreatedEvent.name);
        const payload = (events[0] as GrantCreatedEvent).payload;
        assert.deepEqual(payload.subjectIds, subjectIds);
      });
    });

    describe('handleRotateTokenCommand', async () => {
      async function createIssuedGrant(
        keys: ReturnType<typeof generateTestKeys>
      ) {
        const createCmd = makeCreateGrantCmd({
          client: JSON.stringify(keys.publicKey),
          signatureData: await signedSignatureData(
            keys.privateKey,
            keys.publicKey.kid
          )
        });
        const { events } = await aggregate.handleBatch([createCmd]);
        await aggregate.flush();
        assert.equal(events[0].msgName, GrantCreatedEvent.name);
        const payload = (events[0] as GrantCreatedEvent).payload;
        return {
          grantId: payload.id,
          tokenValue: payload.accessTokenValue!,
          managementId: payload.accessTokenManagementId!
        };
      }

      it('rotates the token and emits TokenRotatedEvent with a new value and managementId', async () => {
        const keys = generateTestKeys();
        const { grantId, tokenValue, managementId } =
          await createIssuedGrant(keys);

        const cmd = new RotateTokenCmd(
          {
            id: grantId,
            value: tokenValue,
            managementId,
            signatureData: await signedSignatureData(
              keys.privateKey,
              keys.publicKey.kid
            )
          },
          randomUUID()
        );

        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, TokenRotatedEvent.name);
        const payload = (events[0] as TokenRotatedEvent).payload;
        assert.equal(payload.id, grantId);
        assert.ok(payload.newAccessTokenValue);
        assert.ok(payload.newAccessTokenManagementId);
        assert.notEqual(payload.newAccessTokenValue, tokenValue);
        assert.notEqual(payload.newAccessTokenManagementId, managementId);
        assert.equal(payload.newAccessTokenExpiresIn, 10_000);
      });

      it('fails with UnknownAccessTokenError for an unknown token value', async () => {
        const keys = generateTestKeys();
        const { grantId, managementId } = await createIssuedGrant(keys);

        const cmd = new RotateTokenCmd(
          {
            id: grantId,
            value: 'wrong-token-value',
            managementId,
            signatureData: await signedSignatureData(
              keys.privateKey,
              keys.publicKey.kid
            )
          },
          randomUUID()
        );

        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, TokenRotationFailedEvent.name);
        const payload = (events[0] as TokenRotationFailedEvent).payload;
        assert.equal(payload.errorName, 'UnknownAccessTokenError');
        assert.equal(payload.grantId, grantId);
      });

      it('fails with UnknownAccessTokenError when managementId does not match', async () => {
        const keys = generateTestKeys();
        const { grantId, tokenValue } = await createIssuedGrant(keys);

        const cmd = new RotateTokenCmd(
          {
            id: grantId,
            value: tokenValue,
            managementId: 'wrong-management-id',
            signatureData: await signedSignatureData(
              keys.privateKey,
              keys.publicKey.kid
            )
          },
          randomUUID()
        );

        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, TokenRotationFailedEvent.name);
        const payload = (events[0] as TokenRotationFailedEvent).payload;
        assert.equal(payload.errorName, 'UnknownAccessTokenError');
      });

      it('fails with UnauthorizedRequestError when the signature is invalid', async () => {
        const keys = generateTestKeys();
        const signerKeys = generateTestKeys();
        const { grantId, tokenValue, managementId } =
          await createIssuedGrant(keys);

        const cmd = new RotateTokenCmd(
          {
            id: grantId,
            value: tokenValue,
            managementId,
            signatureData: await signedSignatureData(
              signerKeys.privateKey,
              keys.publicKey.kid
            )
          },
          randomUUID()
        );

        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, TokenRotationFailedEvent.name);
        const payload = (events[0] as TokenRotationFailedEvent).payload;
        assert.equal(payload.errorName, 'UnauthorizedRequestError');
      });

      it('fails with UnknownAccessTokenError when rotating an already-revoked token', async () => {
        const keys = generateTestKeys();
        const { grantId, tokenValue, managementId } =
          await createIssuedGrant(keys);

        // Issue the first rotation and the replay attempt in the same batch so
        // the aggregate's in-memory grant map carries the revoked state into
        // the second command without needing cross-batch persistence.
        const firstCmd = new RotateTokenCmd(
          {
            id: grantId,
            value: tokenValue,
            managementId,
            signatureData: await signedSignatureData(
              keys.privateKey,
              keys.publicKey.kid
            )
          },
          randomUUID()
        );
        const replayCmd = new RotateTokenCmd(
          {
            id: grantId,
            value: tokenValue,
            managementId,
            signatureData: await signedSignatureData(
              keys.privateKey,
              keys.publicKey.kid
            )
          },
          randomUUID()
        );
        const { events } = await aggregate.handleBatch([firstCmd, replayCmd]);

        // Two events: first succeeds, second fails.
        assert.equal(events.length, 2);
        assert.equal(events[0].msgName, TokenRotatedEvent.name);
        assert.equal(events[1].msgName, TokenRotationFailedEvent.name);
        const failPayload = (events[1] as TokenRotationFailedEvent).payload;
        assert.equal(failPayload.errorName, 'UnknownAccessTokenError');
        assert.equal(failPayload.grantId, grantId);
      });
    });

    describe('handleRevokeTokenCommand', () => {
      async function createIssuedGrant() {
        const keys = generateTestKeys();
        const createCmd = makeCreateGrantCmd({
          client: JSON.stringify(keys.publicKey),
          signatureData: await signedSignatureData(
            keys.privateKey,
            keys.publicKey.kid
          )
        });
        const { events } = await aggregate.handleBatch([createCmd]);
        await aggregate.flush();

        const created = events[0] as GrantCreatedEvent;
        assert.ok(created.payload.accessTokenValue);
        assert.ok(created.payload.accessTokenManagementId);

        return {
          keys,
          grantId: created.payload.id,
          tokenValue: created.payload.accessTokenValue!,
          managementId: created.payload.accessTokenManagementId!
        };
      }

      it('revokes a valid token and persists the revocation', async () => {
        const { keys, grantId, tokenValue, managementId } =
          await createIssuedGrant();

        const before = await aggregate.handleBatch([
          makeIntrospectTokenCmd({ id: grantId, tokenValue })
        ]);
        assert.equal(before.events[0].msgName, TokenIntrospectedEvent.name);
        assert.equal(
          (before.events[0] as TokenIntrospectedEvent).payload.active,
          true
        );

        const { events } = await aggregate.handleBatch([
          new RevokeTokenCmd(
            {
              id: grantId,
              value: tokenValue,
              managementId,
              signatureData: await signedSignatureData(
                keys.privateKey,
                keys.publicKey.kid
              )
            },
            randomUUID()
          )
        ]);
        await aggregate.flush();

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, TokenRevokedEvent.name);
        assert.equal((events[0] as TokenRevokedEvent).payload.id, grantId);

        const stored = await repo.fetchById(grantId);
        assert.ok(stored);
        const revoked = stored.accessTokens.find((t) => t.value === tokenValue);
        assert.ok(revoked?.revokedAt);

        const after = await aggregate.handleBatch([
          makeIntrospectTokenCmd({ id: grantId, tokenValue })
        ]);
        assert.equal(after.events[0].msgName, TokenIntrospectedEvent.name);
        assert.equal(
          (after.events[0] as TokenIntrospectedEvent).payload.active,
          false
        );
      });

      it('fails with UnauthorizedRequestError for an invalid signature', async () => {
        const { grantId, tokenValue, managementId } = await createIssuedGrant();
        const wrongKeys = generateTestKeys();

        const { events } = await aggregate.handleBatch([
          new RevokeTokenCmd(
            {
              id: grantId,
              value: tokenValue,
              managementId,
              signatureData: await signedSignatureData(
                wrongKeys.privateKey,
                wrongKeys.publicKey.kid
              )
            },
            randomUUID()
          )
        ]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, TokenRevokeFailedEvent.name);
        const payload = (events[0] as TokenRevokeFailedEvent).payload;
        assert.equal(payload.errorName, 'UnauthorizedRequestError');
        assert.equal(payload.grantId, grantId);
      });

      it('fails with UnknownAccessTokenError for an unknown token value', async () => {
        const { keys, grantId, managementId } = await createIssuedGrant();

        const { events } = await aggregate.handleBatch([
          new RevokeTokenCmd(
            {
              id: grantId,
              value: 'unknown-token-value',
              managementId,
              signatureData: await signedSignatureData(
                keys.privateKey,
                keys.publicKey.kid
              )
            },
            randomUUID()
          )
        ]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, TokenRevokeFailedEvent.name);
        const payload = (events[0] as TokenRevokeFailedEvent).payload;
        assert.equal(payload.errorName, 'UnknownAccessTokenError');
      });

      it('fails with UnknownAccessTokenError for a mismatched managementId', async () => {
        const { keys, grantId, tokenValue } = await createIssuedGrant();

        const { events } = await aggregate.handleBatch([
          new RevokeTokenCmd(
            {
              id: grantId,
              value: tokenValue,
              managementId: 'wrong-management-id',
              signatureData: await signedSignatureData(
                keys.privateKey,
                keys.publicKey.kid
              )
            },
            randomUUID()
          )
        ]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, TokenRevokeFailedEvent.name);
        const payload = (events[0] as TokenRevokeFailedEvent).payload;
        assert.equal(payload.errorName, 'UnknownAccessTokenError');
      });

      it('fails with GrantNotFoundError when the grant does not exist', async () => {
        const keys = generateTestKeys();
        const missingGrantId = randomUUID();

        const { events } = await aggregate.handleBatch([
          new RevokeTokenCmd(
            {
              id: missingGrantId,
              value: 'token',
              managementId: 'management-id',
              signatureData: await signedSignatureData(
                keys.privateKey,
                keys.publicKey.kid
              )
            },
            randomUUID()
          )
        ]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, TokenRevokeFailedEvent.name);
        const payload = (events[0] as TokenRevokeFailedEvent).payload;
        assert.equal(payload.errorName, 'GrantNotFoundError');
        assert.equal(payload.grantId, missingGrantId);
      });
    });

    describe('handleRevokeGrantCommand', () => {
      it('revokes a continuable grant and clears continue credentials', async () => {
        const { keys, grantId, continueToken, continueId } =
          await createInteractiveGrant();

        const { events } = await aggregate.handleBatch([
          new RevokeGrantCmd(
            {
              id: grantId,
              continueToken,
              continueId,
              signatureData: await signedSignatureData(
                keys.privateKey,
                keys.publicKey.kid
              )
            },
            randomUUID()
          )
        ]);
        await aggregate.flush();

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, GrantRevokedEvent.name);
        assert.equal((events[0] as GrantRevokedEvent).payload.id, grantId);

        const stored = await repo.fetchById(grantId);
        assert.ok(stored);
        assert.equal(stored.state, GrantState.REVOKED);
        assert.equal(stored.continueToken, undefined);
        assert.equal(stored.continueId, undefined);
      });

      it('fails with InvalidGrantError for an invalid continue token', async () => {
        const { keys, grantId, continueId } = await createInteractiveGrant();

        const { events } = await aggregate.handleBatch([
          new RevokeGrantCmd(
            {
              id: grantId,
              continueToken: 'invalid-continue-token',
              continueId,
              signatureData: await signedSignatureData(
                keys.privateKey,
                keys.publicKey.kid
              )
            },
            randomUUID()
          )
        ]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, GrantRevokeFailedEvent.name);
        const payload = (events[0] as GrantRevokeFailedEvent).payload;
        assert.equal(payload.errorName, 'InvalidGrantError');
        assert.equal(payload.message, 'Invalid continue token or continue id');
        assert.equal(payload.grantId, grantId);
      });

      it('fails with UnauthorizedRequestError for an invalid signature', async () => {
        const { grantId, continueToken, continueId } =
          await createInteractiveGrant();
        const wrongKeys = generateTestKeys();

        const { events } = await aggregate.handleBatch([
          new RevokeGrantCmd(
            {
              id: grantId,
              continueToken,
              continueId,
              signatureData: await signedSignatureData(
                wrongKeys.privateKey,
                wrongKeys.publicKey.kid
              )
            },
            randomUUID()
          )
        ]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, GrantRevokeFailedEvent.name);
        const payload = (events[0] as GrantRevokeFailedEvent).payload;
        assert.equal(payload.errorName, 'UnauthorizedRequestError');
        assert.equal(payload.grantId, grantId);
      });

      it('fails with InvalidGrantError when the grant has already been revoked', async () => {
        const { keys, grantId, continueToken, continueId } =
          await createInteractiveGrant();

        await aggregate.handleBatch([
          new RevokeGrantCmd(
            {
              id: grantId,
              continueToken,
              continueId,
              signatureData: await signedSignatureData(
                keys.privateKey,
                keys.publicKey.kid
              )
            },
            randomUUID()
          )
        ]);
        await aggregate.flush();

        const { events } = await aggregate.handleBatch([
          new RevokeGrantCmd(
            {
              id: grantId,
              continueToken,
              continueId,
              signatureData: await signedSignatureData(
                keys.privateKey,
                keys.publicKey.kid
              )
            },
            randomUUID()
          )
        ]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, GrantRevokeFailedEvent.name);
        const payload = (events[0] as GrantRevokeFailedEvent).payload;
        assert.equal(payload.errorName, 'InvalidGrantError');
        assert.equal(
          payload.message,
          `Current state ${GrantState.REVOKED} is a finalized state and cannot be changed`
        );
      });

      it('fails with GrantNotFoundError when the grant does not exist', async () => {
        const keys = generateTestKeys();
        const missingGrantId = randomUUID();

        const { events } = await aggregate.handleBatch([
          new RevokeGrantCmd(
            {
              id: missingGrantId,
              continueToken: 'token',
              continueId: 'id',
              signatureData: await signedSignatureData(
                keys.privateKey,
                keys.publicKey.kid
              )
            },
            randomUUID()
          )
        ]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, GrantRevokeFailedEvent.name);
        const payload = (events[0] as GrantRevokeFailedEvent).payload;
        assert.equal(payload.errorName, 'GrantNotFoundError');
        assert.equal(payload.grantId, missingGrantId);
      });
    });

    describe('handleIntrospectTokenCommand', async () => {
      async function createAndFlushIssuedGrant(
        access: CreateGrantCmdPayload['access'] = [
          { type: AccessType.INCOMING_PAYMENT, actions: [AccessAction.READ] }
        ]
      ): Promise<{ id: string; tokenValue: string }> {
        const keys = generateTestKeys();
        const createCmd = makeCreateGrantCmd({
          client: JSON.stringify(keys.publicKey),
          signatureData: await signedSignatureData(
            keys.privateKey,
            keys.publicKey.kid
          ),
          access
        });
        const { events } = await aggregate.handleBatch([createCmd]);
        const payload = (events[0] as GrantCreatedEvent).payload;

        await aggregate.flush();

        return {
          id: createCmd.payload.id,
          tokenValue: payload.accessTokenValue as string
        };
      }

      it('returns active: true for a valid access token', async () => {
        const access = [
          { type: AccessType.INCOMING_PAYMENT, actions: [AccessAction.READ] }
        ];
        const { id, tokenValue } = await createAndFlushIssuedGrant(access);

        const { events } = await aggregate.handleBatch([
          makeIntrospectTokenCmd({ id, tokenValue })
        ]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, TokenIntrospectedEvent.name);
        const payload = (events[0] as TokenIntrospectedEvent).payload;
        assert.equal(payload.id, id);
        assert.equal(payload.active, true);
        assert.deepEqual(payload.access, access);
      });

      it('returns active: false for an access token value that does not match', async () => {
        const { id } = await createAndFlushIssuedGrant();

        const { events } = await aggregate.handleBatch([
          makeIntrospectTokenCmd({ id, tokenValue: 'unknown-token-value' })
        ]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, TokenIntrospectedEvent.name);
        const payload = (events[0] as TokenIntrospectedEvent).payload;
        assert.equal(payload.active, false);
        assert.equal(payload.access, undefined);
      });

      it('restricts the returned access to the requested access items', async () => {
        const access = [
          { type: AccessType.INCOMING_PAYMENT, actions: [AccessAction.READ] },
          { type: AccessType.QUOTE, actions: [AccessAction.CREATE] }
        ];
        const { id, tokenValue } = await createAndFlushIssuedGrant(access);

        const { events } = await aggregate.handleBatch([
          makeIntrospectTokenCmd({
            id,
            tokenValue,
            access: [access[0]]
          })
        ]);

        assert.equal(events[0].msgName, TokenIntrospectedEvent.name);
        const payload = (events[0] as TokenIntrospectedEvent).payload;
        assert.equal(payload.active, true);
        assert.deepEqual(payload.access, [access[0]]);
      });

      it('returns active: false when the requested access items are not fully covered by the grant', async () => {
        const access = [
          { type: AccessType.INCOMING_PAYMENT, actions: [AccessAction.READ] }
        ];
        const { id, tokenValue } = await createAndFlushIssuedGrant(access);

        const { events } = await aggregate.handleBatch([
          makeIntrospectTokenCmd({
            id,
            tokenValue,
            access: [
              ...access,
              { type: AccessType.QUOTE, actions: [AccessAction.CREATE] }
            ]
          })
        ]);

        assert.equal(events[0].msgName, TokenIntrospectedEvent.name);
        const payload = (events[0] as TokenIntrospectedEvent).payload;
        assert.equal(payload.active, false);
      });

      it('returns active: false when the grant does not exist', async () => {
        const id = randomUUID();
        const debugMock = mock.method(logger, 'debug', () => {});

        const { events } = await aggregate.handleBatch([
          makeIntrospectTokenCmd({ id, tokenValue: 'some-token-value' })
        ]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, TokenIntrospectedEvent.name);
        const payload = (events[0] as TokenIntrospectedEvent).payload;
        assert.equal(payload.id, id);
        assert.equal(payload.active, false);
        assert.equal(
          debugMock.mock.calls.some(
            (call) =>
              call.arguments[0] ===
              `Grant ${id} not found - command: IntrospectTokenCmd`
          ),
          true
        );
      });

      it('returns active: false and logs the error when introspection fails unexpectedly', async () => {
        const { id, tokenValue } = await createAndFlushIssuedGrant();
        const errorMock = mock.method(logger, 'error', () => {});
        mock.method(GrantEntity.prototype, 'introspectAccessToken', () => {
          throw new Error('unexpected failure');
        });

        const { events } = await aggregate.handleBatch([
          makeIntrospectTokenCmd({ id, tokenValue })
        ]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, TokenIntrospectedEvent.name);
        const payload = (events[0] as TokenIntrospectedEvent).payload;
        assert.equal(payload.id, id);
        assert.equal(payload.active, false);
        assert.equal(errorMock.mock.callCount(), 1);
      });
    });

    describe('handleStartInteractionCommand', () => {
      it('starts the interaction and returns GrantInteractionStartedEvent when the nonce matches', async () => {
        const storeInteractionsMock = mock.method(repo, 'storeInteractions');

        const { grantId } = await createInteractiveGrant();
        const requestId = randomUUID();

        const { events } = await aggregate.handleBatch([
          new StartInteractionCmd({ id: grantId }, requestId)
        ]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, GrantInteractionStartedEvent.name);
        const payload = (events[0] as GrantInteractionStartedEvent).payload;
        assert.equal(payload.id, grantId);
        assert.ok(payload.nonce);
        assert.equal(events[0].requestId, requestId);

        assert.equal(storeInteractionsMock.mock.callCount(), 0);

        await aggregate.flush();

        assert.equal(storeInteractionsMock.mock.callCount(), 1);
        const updates = storeInteractionsMock.mock.calls[0].arguments[0];
        assert.equal(updates.length, 1);
        assert.equal(updates[0].id, grantId);
        assert.ok(updates[0].interaction?.interactRef);
      });

      it('fails with GrantNotFoundError when the grant does not exist', async () => {
        const storeInteractionsMock = mock.method(repo, 'storeInteractions');
        const requestId = randomUUID();

        const { events } = await aggregate.handleBatch([
          new StartInteractionCmd({ id: randomUUID() }, requestId)
        ]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, GrantInteractionStartFailedEvent.name);
        const payload = (events[0] as GrantInteractionStartFailedEvent).payload;
        assert.equal(payload.errorName, 'GrantNotFoundError');
        assert.equal(events[0].requestId, requestId);
        await aggregate.flush();

        assert.equal(storeInteractionsMock.mock.callCount(), 0);
      });

      describe('handleFinishInteractionCommand', async () => {
        function makeGrantWithInteraction(
          interactionOverrides: Partial<{
            nonce: string;
            state: InteractionState;
          }> = {}
        ): IGrant {
          const createdAt = new Date();
          return {
            id: randomUUID(),
            startMethods: ['REDIRECT'],
            state: GrantState.PROCESSING,
            interactionNonce: generateNonce(),
            finishNonce: generateNonce(),
            accessTokens: [],
            interaction: {
              interactRef: randomUUID(),
              nonce: 'correct-nonce',
              createdAt,
              expiresAt: new Date(createdAt.getTime() + 600_000),
              state: InteractionState.APPROVED,
              ...interactionOverrides
            }
          };
        }

        it('returns GrantInteractionFinishedEvent when the interaction was approved', async () => {
          const grant = makeGrantWithInteraction();
          await repo.storeMany([grant]);
          const requestId = randomUUID();

          const { events } = await aggregate.handleBatch([
            new FinishInteractionCmd(
              { id: grant.id, nonce: grant.interactionNonce as string },
              requestId
            )
          ]);

          assert.equal(events.length, 1);
          assert.equal(events[0].msgName, GrantInteractionFinishedEvent.name);
          assert.equal(events[0].requestId, requestId);
          const payload = (events[0] as GrantInteractionFinishedEvent).payload;
          assert.equal(payload.id, grant.id);
          assert.equal(payload.interactNonce, grant.interactionNonce);
          assert.equal(payload.clientNonce, grant.finishNonce);
          assert.equal(payload.interactRef, grant.interaction?.interactRef);
        });

        it('fails with UnknownInteractionError when the nonce does not match', async () => {
          const grant = makeGrantWithInteraction();
          await repo.storeMany([grant]);
          const requestId = randomUUID();

          const { events } = await aggregate.handleBatch([
            new FinishInteractionCmd(
              { id: grant.id, nonce: 'wrong-nonce' },
              requestId
            )
          ]);

          assert.equal(events.length, 1);
          assert.equal(
            events[0].msgName,
            GrantInteractionFinishFailedEvent.name
          );
          assert.equal(events[0].requestId, requestId);
          const payload = (events[0] as GrantInteractionFinishFailedEvent)
            .payload;
          assert.equal(payload.grantId, grant.id);
          assert.equal(payload.errorName, 'UnknownInteractionError');
        });

        it('fails with InvalidInteractionError when the interaction is still pending', async () => {
          const grant = makeGrantWithInteraction({
            state: InteractionState.PENDING
          });
          await repo.storeMany([grant]);
          const requestId = randomUUID();

          const { events } = await aggregate.handleBatch([
            new FinishInteractionCmd(
              { id: grant.id, nonce: grant.interactionNonce as string },
              requestId
            )
          ]);

          assert.equal(events.length, 1);
          assert.equal(
            events[0].msgName,
            GrantInteractionFinishFailedEvent.name
          );
          const payload = (events[0] as GrantInteractionFinishFailedEvent)
            .payload;
          assert.equal(payload.grantId, grant.id);
          assert.equal(payload.errorName, 'InvalidInteractionError');
        });

        it('fails with GrantNotFoundError when the grant does not exist', async () => {
          const requestId = randomUUID();

          const { events } = await aggregate.handleBatch([
            new FinishInteractionCmd(
              { id: randomUUID(), nonce: 'any-nonce' },
              requestId
            )
          ]);

          assert.equal(events.length, 1);
          assert.equal(
            events[0].msgName,
            GrantInteractionFinishFailedEvent.name
          );
          assert.equal(events[0].requestId, requestId);
          const payload = (events[0] as GrantInteractionFinishFailedEvent)
            .payload;
          assert.equal(payload.errorName, 'GrantNotFoundError');
        });
      });
    });
  });
});
