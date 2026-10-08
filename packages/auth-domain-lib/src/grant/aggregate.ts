import { getErrorDetails, ILogger, IMessage } from 'common-types-lib';
import {
  ContinueGrantCmd,
  CreateGrantCmd,
  AcceptInteractionCmd,
  RejectInteractionCmd,
  RevokeGrantCmd,
  AdminRevokeGrantCmd,
  IntrospectTokenCmd,
  RotateTokenCmd,
  RevokeTokenCmd,
  StartInteractionCmd,
  FinishInteractionCmd
} from '../commands';
import {
  DuplicateGrantError,
  GrantNotFoundError,
  UnauthorizedRequestError
} from './errors';
import {
  GrantCreatedEvent,
  GrantCreateFailedEvent,
  GrantContinuedEvent,
  GrantContinueFailedEvent,
  GrantInteractionChoiceHandledEvent,
  GrantInteractionChoiceFailedEvent,
  GrantRevokedEvent,
  GrantRevokeFailedEvent,
  TokenIntrospectedEvent,
  TokenRotatedEvent,
  TokenRotationFailedEvent,
  TokenRevokedEvent,
  TokenRevokeFailedEvent,
  GrantInteractionStartedEvent,
  GrantInteractionStartFailedEvent,
  GrantInteractionFinishedEvent,
  GrantInteractionFinishFailedEvent
} from './events';
import {
  AccessAction,
  AccessType,
  IAccessItem,
  IAccessLimit,
  IAccessToken,
  IFinishMethod,
  IGrant,
  IGrantRepository,
  IInteraction,
  IJsonWebKey,
  InteractionChoice,
  InteractionState,
  isJWK,
  IStartMethod,
  ISubjectId,
  IWalletAddressService,
  IRotatedGrantUpdate,
  IRevokedGrantUpdate
} from './interfaces';
import { GRANT_POLL_MS, GrantEntity } from './entity';
import { JWK, validateSignature } from '@interledger/http-signature-utils';

export interface IGrantService {
  fetchByIds(grantIds: string[]): Promise<IGrant[]>;
}

export class GrantAggregate {
  private newGrantIds: string[] = [];
  private grantIdsWithRotatedTokens = new Map<string, IRotatedGrantUpdate>();
  private clientKeysToResolve: {
    grantId: string;
    requestId: string;
    kid: string;
  }[] = [];
  private continuedGrantIds = new Set<string>();
  private continuedGrantAccessTokens = new Map<string, IAccessToken>();
  private revokedTokens = new Map<string, IAccessToken>();
  private revokedGrantIds = new Set<string>();
  private grantMap = new Map<string, GrantEntity>();
  private newGrantInteractions = new Set<string>(); // grant ids
  private updatedGrantInteractions = new Set<string>(); // grant ids
  private finishedInteractiveGrantIds = new Set<string>();
  private walletAddressRequestMap = new Map<
    string,
    { kid: string; requestId: string }[]
  >();
  private requestIdToClientKeyMap = new Map<string, IJsonWebKey>();
  private requestIdToClientNameMap = new Map<string, string>();

  constructor(
    private _repo: IGrantRepository,
    private _walletAddressService: IWalletAddressService,
    private _logger: ILogger
  ) {}

  async handleBatch(cmds: IMessage[]): Promise<{ events: IMessage[] }> {
    this._logger.debug(`handleBatch — ${cmds.length} cmd(s)`);
    const outputEvents: IMessage[] = [];

    const grantIdSet = new Set<string>();
    const walletAddressKeyRequestSet = new Set<string>();
    const clientNameRequestSet = new Set<string>();

    for (const cmd of cmds) {
      if (cmd.msgName === CreateGrantCmd.name) {
        const payload = (cmd as CreateGrantCmd).payload;
        grantIdSet.add(payload.id);
        if (!this.parseJWKJson(payload.client)) {
          walletAddressKeyRequestSet.add(payload.client);
          clientNameRequestSet.add(payload.client);
          const walletAddressToRequest = this.walletAddressRequestMap.get(
            payload.client
          );
          const requestInfo = {
            kid: payload.signatureData.kid,
            requestId: (cmd as CreateGrantCmd).requestId
          };
          this.walletAddressRequestMap.set(
            payload.client,
            walletAddressToRequest
              ? [...walletAddressToRequest, requestInfo]
              : [requestInfo]
          );
        } else {
          this.requestIdToClientKeyMap.set(
            (cmd as CreateGrantCmd).requestId,
            this.parseJWKJson(payload.client) as JWK
          );
        }
      } else if (
        cmd.msgName === ContinueGrantCmd.name ||
        cmd.msgName === RevokeGrantCmd.name ||
        cmd.msgName === RotateTokenCmd.name ||
        cmd.msgName === RevokeTokenCmd.name
      ) {
        grantIdSet.add(
          (
            cmd as
              | ContinueGrantCmd
              | RevokeGrantCmd
              | RotateTokenCmd
              | RevokeTokenCmd
          ).payload.id
        );
        this.clientKeysToResolve.push({
          grantId: cmd.payload.id,
          requestId: (
            cmd as
              | ContinueGrantCmd
              | RevokeGrantCmd
              | RotateTokenCmd
              | RevokeTokenCmd
          ).requestId,
          kid: (
            cmd as
              | ContinueGrantCmd
              | RevokeGrantCmd
              | RotateTokenCmd
              | RevokeTokenCmd
          ).payload.signatureData.kid
        });
      } else if (
        cmd.msgName === AdminRevokeGrantCmd.name ||
        cmd.msgName === IntrospectTokenCmd.name ||
        cmd.msgName === StartInteractionCmd.name ||
        cmd.msgName === AcceptInteractionCmd.name ||
        cmd.msgName === RejectInteractionCmd.name ||
        cmd.msgName === FinishInteractionCmd.name
      ) {
        grantIdSet.add(
          (
            cmd as
              | RevokeGrantCmd
              | AdminRevokeGrantCmd
              | IntrospectTokenCmd
              | RotateTokenCmd
              | RevokeTokenCmd
              | StartInteractionCmd
              | AcceptInteractionCmd
              | RejectInteractionCmd
              | FinishInteractionCmd
          ).payload.id
        );
      }
    }

    const grants = await this._repo.fetchByIds([...grantIdSet]);

    for (const grant of grants) {
      this.grantMap.set(grant.id, GrantEntity.fromObject(grant));
    }

    for (const { grantId, requestId, kid } of this.clientKeysToResolve) {
      const grant = this.grantMap.get(grantId);
      if (!grant) continue; // Grant not found error thrown in command handler.

      this.getWaRequestsFromCmds(
        grant,
        walletAddressKeyRequestSet,
        kid,
        requestId
      );
    }

    const getKeys = async (walletAddress: string): Promise<void> => {
      const keys =
        await this._walletAddressService.getWalletAddressKeys(walletAddress);
      const requestIdAndKid =
        this.walletAddressRequestMap.get(walletAddress) ?? [];

      for (const requested of requestIdAndKid) {
        const key = keys.find((key) => key.kid === requested.kid);
        if (key) this.requestIdToClientKeyMap.set(requested.requestId, key);
      }
    };

    const getClientName = async (walletAddress: string): Promise<void> => {
      const clientName =
        await this._walletAddressService.getWalletAddressPublicName(
          walletAddress
        );
      const requestIds = this.walletAddressRequestMap.get(walletAddress) ?? [];

      for (const { requestId } of requestIds) {
        if (clientName)
          this.requestIdToClientNameMap.set(requestId, clientName);
      }
    };

    await Promise.all([...walletAddressKeyRequestSet].map((wa) => getKeys(wa)));
    await Promise.all([...clientNameRequestSet].map((wa) => getClientName(wa)));

    for (const cmd of cmds) {
      let event: IMessage;
      if (cmd.msgName == CreateGrantCmd.name) {
        event = await this.handleCreateGrantCommand(cmd as CreateGrantCmd);
      } else if (cmd.msgName === ContinueGrantCmd.name) {
        event = await this.handleContinueGrantCommand(cmd as ContinueGrantCmd);
      } else if (cmd.msgName === RevokeGrantCmd.name) {
        event = await this.handleRevokeGrantCommand(cmd as RevokeGrantCmd);
      } else if (cmd.msgName === AdminRevokeGrantCmd.name) {
        event = this.handleAdminRevokeGrantCommand(cmd as AdminRevokeGrantCmd);
      } else if (cmd.msgName === IntrospectTokenCmd.name) {
        event = this.handleIntrospectTokenCommand(cmd as IntrospectTokenCmd);
      } else if (cmd.msgName === RotateTokenCmd.name) {
        event = await this.handleRotateTokenCommand(cmd as RotateTokenCmd);
      } else if (cmd.msgName === RevokeTokenCmd.name) {
        event = await this.handleRevokeTokenCommand(cmd as RevokeTokenCmd);
      } else if (cmd.msgName === StartInteractionCmd.name) {
        event = this.handleStartInteractionCommand(cmd as StartInteractionCmd);
      } else if (cmd.msgName === AcceptInteractionCmd.name) {
        event = this.handleAcceptInteractionCommand(
          cmd as AcceptInteractionCmd
        );
      } else if (cmd.msgName === RejectInteractionCmd.name) {
        event = this.handleRejectInteractionCommand(
          cmd as RejectInteractionCmd
        );
      } else if (cmd.msgName === FinishInteractionCmd.name) {
        event = this.handleFinishInteractionCommand(
          cmd as FinishInteractionCmd
        );
      } else {
        this._logger.error(`Received unexpected command: ${cmd.msgName}`);
        continue;
      }

      outputEvents.push(event);
    }

    return { events: outputEvents };
  }

  private parseJWKJson(json: string): JWK | null {
    try {
      const parsed = JSON.parse(json);
      if (!isJWK(parsed)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private resolveClientKeyForDirectedIdentityGrant(
    grant: GrantEntity
  ): IJsonWebKey | undefined {
    if (typeof grant.client === 'string') {
      return this.parseJWKJson(grant.client) ?? undefined;
    }

    return grant.client;
  }

  private getWaRequestsFromCmds(
    grant: GrantEntity,
    walletAddressSet: Set<string>,
    kid: string,
    requestId: string
  ): void {
    if (!grant.client) {
      return;
    }

    if (isJWK(grant.client)) return;

    if (this.parseJWKJson(grant.client as string)) return;

    this._logger.info({ client: grant.client }, 'getting WA Requests from cmd');

    walletAddressSet.add(grant.client as string);
    const walletAddressToRequest = this.walletAddressRequestMap.get(
      grant.client as string
    );
    const requestInfo = {
      kid,
      requestId
    };
    this.walletAddressRequestMap.set(
      grant.client as string,
      walletAddressToRequest
        ? [...walletAddressToRequest, requestInfo]
        : [requestInfo]
    );
  }

  // Signature Header validation can be performed in the application.
  private async validateRequestSignature(
    key: JWK,
    url: string,
    method: string,
    body: string,
    headers: Record<string, string>
  ): Promise<boolean> {
    const requestLike = {
      method,
      body,
      url,
      headers
    };
    return validateSignature(key, requestLike);
  }

  private async handleCreateGrantCommand(cmd: CreateGrantCmd) {
    this._logger.debug(`handleCreateGrantCommand — id: ${cmd.payload.id}`);
    try {
      const { id } = cmd.payload;
      if (this.grantMap.has(id)) {
        throw new DuplicateGrantError(`Grant with id ${id} already exists`);
      }

      const clientKey = this.requestIdToClientKeyMap.get(cmd.requestId);
      if (!clientKey) {
        throw new UnauthorizedRequestError();
      }
      const {
        signatureData: { url, method, body, headers }
      } = cmd.payload;
      const isValidSignature = await this.validateRequestSignature(
        clientKey as JWK,
        url,
        method,
        body,
        headers
      );
      if (!isValidSignature) {
        throw new UnauthorizedRequestError();
      }

      const accessItems: IAccessItem[] | undefined = cmd.payload.access?.map(
        (access) => {
          const accessItem = {
            ...access,
            type: access.type as AccessType,
            actions: access.actions as AccessAction[]
          };
          if (access.limits) accessItem.limits = access.limits as IAccessLimit;
          return accessItem;
        }
      );

      const { entity, accessToken } = GrantEntity.create({
        ...cmd.payload,
        clientName: this.requestIdToClientNameMap.get(cmd.requestId),
        startMethods: cmd.payload.interact?.start as IStartMethod[] | undefined,
        finishMethod: cmd.payload.interact?.finish?.method as IFinishMethod,
        finishNonce: cmd.payload.interact?.finish?.nonce,
        finishUri: cmd.payload.interact?.finish?.uri,
        subjectIds: cmd.payload.subjectIds as ISubjectId[],
        accesses: accessItems
      });

      this.grantMap.set(id, entity);
      this.newGrantIds.push(id);

      this._logger.debug(`handleCreateGrantCommand — created id: ${id}`);

      return new GrantCreatedEvent(
        {
          id,
          continueId: entity.continueId,
          continueToken: entity.continueToken,
          continueWaitMs: entity.continueToken ? GRANT_POLL_MS : undefined,
          interactionNonce: entity.interactionNonce,
          accessTokenValue: accessToken?.value,
          accessTokenManagementId: accessToken?.managementId,
          accessTokenExpiresIn: accessToken?.expiresInMs,
          access: entity.accesses,
          subjectIds: entity.subjectIds
        },
        cmd.requestId
      );
    } catch (err) {
      this._logger.debug(
        `handleCreateGrantCommand — failed id: ${cmd.payload.id} error: ${(err as Error).message}`
      );
      return new GrantCreateFailedEvent(
        {
          grantId: cmd.payload.id,
          ...getErrorDetails(err)
        },
        cmd.requestId
      );
    }
  }

  private async handleContinueGrantCommand(cmd: ContinueGrantCmd) {
    const { id, continueId, continueToken, interactRef } = cmd.payload;
    try {
      const grant = this.grantMap.get(id);
      if (!grant) {
        throw new GrantNotFoundError(`Grant ${id} not found`);
      }

      const clientKey = this.requestIdToClientKeyMap.get(cmd.requestId);
      if (!clientKey) {
        throw new UnauthorizedRequestError();
      }

      const {
        signatureData: { url, method, body, headers }
      } = cmd.payload;

      const isValidSignature = await this.validateRequestSignature(
        clientKey as JWK,
        url,
        method,
        body,
        headers
      );
      if (!isValidSignature) {
        throw new UnauthorizedRequestError();
      }

      const accessToken = grant.continue(
        continueToken,
        continueId,
        interactRef
      );

      this.grantMap.set(id, grant);
      this.continuedGrantIds.add(id);
      if (accessToken) {
        this.continuedGrantAccessTokens.set(id, accessToken);
      }
      return new GrantContinuedEvent(
        {
          id,
          state: grant.state,
          accessTokenValue: accessToken?.value,
          accessTokenManagementId: accessToken?.managementId,
          accessTokenExpiresIn: accessToken?.expiresInMs,
          access: grant.accesses,
          continueId: grant.continueId,
          continueToken: grant.continueToken,
          continueWaitMs: grant.continueToken ? GRANT_POLL_MS : undefined
        },
        cmd.requestId
      );
    } catch (err) {
      return new GrantContinueFailedEvent(
        {
          grantId: cmd.payload.id,
          ...getErrorDetails(err)
        },
        cmd.requestId
      );
    }
  }

  private async handleRevokeGrantCommand(cmd: RevokeGrantCmd) {
    const { id, continueId, continueToken } = cmd.payload;

    try {
      const grant = this.grantMap.get(id);
      if (!grant) {
        throw new GrantNotFoundError(`Grant ${id} not found`);
      }

      const clientKey =
        this.requestIdToClientKeyMap.get(cmd.requestId) ??
        this.resolveClientKeyForDirectedIdentityGrant(grant);

      if (!clientKey) {
        throw new UnauthorizedRequestError();
      }

      const {
        signatureData: { url, method, body, headers }
      } = cmd.payload;

      const isValidSignature = await this.validateRequestSignature(
        clientKey as JWK,
        url,
        method,
        body,
        headers
      );
      if (!isValidSignature) {
        throw new UnauthorizedRequestError();
      }

      const revokedTokens = grant.revoke(continueToken, continueId);

      this.grantMap.set(id, grant);
      this.revokedGrantIds.add(id);
      for (const token of revokedTokens) {
        this.revokedTokens.set(token.value, token);
      }

      return new GrantRevokedEvent(
        {
          id,
          createdAt: grant.createdAt,
          status: grant.state,
          access: grant.accesses,
          client: grant.client,
          clientName: grant.clientName,
          subjectIds: grant.subjectIds,
          ...(grant.interaction && {
            interaction: {
              state: grant.interaction.state,
              createdAt: grant.interaction.createdAt
            }
          })
        },
        cmd.requestId
      );
    } catch (error) {
      return new GrantRevokeFailedEvent(
        {
          grantId: id,
          ...getErrorDetails(error)
        },
        cmd.requestId
      );
    }
  }

  private handleAdminRevokeGrantCommand(cmd: AdminRevokeGrantCmd) {
    const { id } = cmd.payload;
    try {
      const grant = this.grantMap.get(id);
      if (!grant) {
        throw new GrantNotFoundError(`Grant ${id} not found`);
      }
      const revokedTokens = grant.adminRevoke();

      this.grantMap.set(id, grant);
      this.revokedGrantIds.add(id);
      for (const token of revokedTokens) {
        this.revokedTokens.set(token.value, token);
      }

      return new GrantRevokedEvent(
        {
          id,
          status: grant.state,
          createdAt: grant.createdAt
        },
        cmd.requestId
      );
    } catch (error) {
      return new GrantRevokeFailedEvent(
        {
          grantId: id,
          ...getErrorDetails(error)
        },
        cmd.requestId
      );
    }
  }

  private handleIntrospectTokenCommand(cmd: IntrospectTokenCmd) {
    const { id, tokenValue, access } = cmd.payload;
    try {
      const grant = this.grantMap.get(id);
      if (!grant) {
        this._logger.debug(
          `Grant ${id} not found - command: ${IntrospectTokenCmd.name}`
        );
        return new TokenIntrospectedEvent(
          {
            id,
            value: tokenValue,
            active: false
          },
          cmd.requestId
        );
      }

      const accessToken = grant.introspectAccessToken(tokenValue, access);

      this.grantMap.set(id, grant);
      return new TokenIntrospectedEvent(
        {
          id,
          value: tokenValue,
          active: accessToken.active,
          access: accessToken.access
        },
        cmd.requestId
      );
    } catch (err) {
      this._logger.error(
        {
          grantId: cmd.payload.id,
          value: tokenValue,
          errorName: (err as Error).constructor.name,
          message: (err as Error).message
        },
        `Failed to introspect token ${tokenValue} for grant ${cmd.payload.id}`
      );
      return new TokenIntrospectedEvent(
        {
          id: cmd.payload.id,
          value: tokenValue,
          active: false
        },
        cmd.requestId
      );
    }
  }

  private async handleRotateTokenCommand(cmd: RotateTokenCmd) {
    const { id, value, managementId } = cmd.payload;
    try {
      const grant = this.grantMap.get(id);
      if (!grant) {
        throw new GrantNotFoundError(`Grant ${id} not found`);
      }

      const clientKey =
        this.requestIdToClientKeyMap.get(cmd.requestId) ??
        this.resolveClientKeyForDirectedIdentityGrant(grant);
      if (!clientKey) {
        throw new UnauthorizedRequestError();
      }

      const {
        signatureData: { url, method, body, headers }
      } = cmd.payload;

      const isValidSignature = await this.validateRequestSignature(
        clientKey as JWK,
        url,
        method,
        body,
        headers
      );
      if (!isValidSignature) {
        throw new UnauthorizedRequestError();
      }

      const accessToken = grant.rotateAccessToken(value, managementId);
      const revokedToken = grant.accessTokens.find(
        (t) => t.value === value
      ) as IAccessToken;

      this.grantMap.set(id, grant);
      this.grantIdsWithRotatedTokens.set(id, {
        id,
        revokedToken,
        newToken: accessToken
      });

      return new TokenRotatedEvent(
        {
          id,
          newAccessTokenValue: accessToken.value,
          newAccessTokenManagementId: accessToken.managementId,
          newAccessTokenExpiresIn: accessToken.expiresInMs,
          access: grant.accesses
        },
        cmd.requestId
      );
    } catch (err) {
      return new TokenRotationFailedEvent(
        {
          grantId: cmd.payload.id,
          ...getErrorDetails(err)
        },
        cmd.requestId
      );
    }
  }

  private async handleRevokeTokenCommand(cmd: RevokeTokenCmd) {
    const { id, value, managementId } = cmd.payload;

    try {
      const grant = this.grantMap.get(id);
      if (!grant) {
        throw new GrantNotFoundError(`Grant ${id} not found`);
      }

      const clientKey =
        this.requestIdToClientKeyMap.get(cmd.requestId) ??
        this.resolveClientKeyForDirectedIdentityGrant(grant);
      if (!clientKey) {
        throw new UnauthorizedRequestError();
      }

      const {
        signatureData: { url, method, body, headers }
      } = cmd.payload;

      const isValidSignature = await this.validateRequestSignature(
        clientKey as JWK,
        url,
        method,
        body,
        headers
      );
      if (!isValidSignature) {
        throw new UnauthorizedRequestError();
      }

      const revokedToken = grant.revokeAccessToken(value, managementId);
      this.grantMap.set(id, grant);
      this.revokedTokens.set(revokedToken.value, revokedToken);

      return new TokenRevokedEvent(
        {
          id
        },
        cmd.requestId
      );
    } catch (error) {
      return new TokenRevokeFailedEvent(
        {
          grantId: id,
          ...getErrorDetails(error)
        },
        cmd.requestId
      );
    }
  }

  private handleStartInteractionCommand(cmd: StartInteractionCmd) {
    const { id } = cmd.payload;

    try {
      const grant = this.grantMap.get(id);
      if (!grant) {
        throw new GrantNotFoundError(`Grant ${id} not found`);
      }

      const { nonce, clientUri, clientName } = grant.startInteraction();
      this.grantMap.set(id, grant);
      this.newGrantInteractions.add(grant.id);

      return new GrantInteractionStartedEvent(
        { id, nonce, clientUri, clientName },
        cmd.requestId
      );
    } catch (error) {
      return new GrantInteractionStartFailedEvent(
        {
          grantId: id,
          ...getErrorDetails(error)
        },
        cmd.requestId
      );
    }
  }

  private handleFinishInteractionCommand(cmd: FinishInteractionCmd) {
    const { id, nonce } = cmd.payload;

    try {
      const grant = this.grantMap.get(id);
      if (!grant) {
        throw new GrantNotFoundError(
          `Grant ${id} not found - command: ${FinishInteractionCmd.name}`
        );
      }

      grant.finishInteraction(nonce);
      this.grantMap.set(id, grant);
      this.finishedInteractiveGrantIds.add(id);

      return new GrantInteractionFinishedEvent(
        {
          id,
          interactNonce: grant.interactionNonce as string,
          clientNonce: grant.finishNonce as string,
          interactRef: (grant.interaction as IInteraction).interactRef,
          clientFinishUri: grant.finishUri
        },
        cmd.requestId
      );
    } catch (error) {
      return new GrantInteractionFinishFailedEvent(
        {
          grantId: id,
          ...getErrorDetails(error)
        },
        cmd.requestId
      );
    }
  }

  private handleInteractionChoice(
    id: string,
    choice: InteractionChoice,
    requestId?: string
  ) {
    try {
      const grant = this.grantMap.get(id);
      if (!grant) {
        throw new GrantNotFoundError(`Grant ${id} not found`);
      }

      grant.handleInteraction(choice);
      this.grantMap.set(id, grant);
      this.updatedGrantInteractions.add(id);

      return new GrantInteractionChoiceHandledEvent(
        {
          id,
          choice
        },
        requestId
      );
    } catch (error) {
      return new GrantInteractionChoiceFailedEvent(
        {
          grantId: id,
          ...getErrorDetails(error)
        },
        requestId
      );
    }
  }

  private handleAcceptInteractionCommand(cmd: AcceptInteractionCmd) {
    const { id } = cmd.payload;

    return this.handleInteractionChoice(
      id,
      InteractionState.APPROVED,
      cmd.requestId
    );
  }

  private handleRejectInteractionCommand(cmd: RejectInteractionCmd) {
    const { id } = cmd.payload;

    return this.handleInteractionChoice(
      id,
      InteractionState.REJECTED,
      cmd.requestId
    );
  }

  public async flush() {
    const promises = [];

    if (this.newGrantIds.length > 0) {
      const newEntities = [];
      for (const id of this.newGrantIds) {
        const grant = this.grantMap.get(id);
        if (!grant) {
          this._logger.error(`Grant ${id} missing from grantMap during flush`);
          continue;
        }

        newEntities.push(grant.toObject());
      }

      promises.push(this._repo.storeMany(newEntities));
    }

    if (this.grantIdsWithRotatedTokens.size > 0) {
      promises.push(
        this._repo.storeRotatedGrants([
          ...this.grantIdsWithRotatedTokens.values()
        ])
      );
    }

    if (this.continuedGrantIds.size > 0) {
      const continuedEntities = [];
      for (const id of this.continuedGrantIds) {
        const grant = this.grantMap.get(id);
        if (!grant) {
          this._logger.error(
            `Grant ${id} missing from grantMap during continue flush`
          );
          continue;
        }
        continuedEntities.push({
          id: grant.id,
          state: grant.state,
          continueToken: grant.continueToken,
          continueId: grant.continueId,
          lastContinuedAt: grant.lastContinuedAt,
          accessToken: this.continuedGrantAccessTokens.get(id)
        });
      }

      promises.push(this._repo.storeContinuedGrants(continuedEntities));
    }

    if (this.finishedInteractiveGrantIds.size > 0) {
      const finishedEntities = [];
      for (const id of this.finishedInteractiveGrantIds) {
        const grant = this.grantMap.get(id);
        if (!grant) {
          this._logger.error(
            `Grant ${id} missing from grantMap during finish interaction flush`
          );
          continue;
        }
        finishedEntities.push({
          id: grant.id,
          state: grant.state
        });
        promises.push(
          this._repo.storeFinishedInteractiveGrants(finishedEntities)
        );
      }
    }

    if (this.revokedGrantIds.size > 0) {
      const revokedGrants: IRevokedGrantUpdate[] = [];
      for (const id of this.revokedGrantIds) {
        const grant = this.grantMap.get(id);
        if (!grant) {
          this._logger.error(
            `Grant ${id} missing from grantMap during revoke flush`
          );
          continue;
        }

        revokedGrants.push({
          id: grant.id,
          state: grant.state
        });
      }

      promises.push(this._repo.storeRevokedGrants(revokedGrants));
    }

    if (this.newGrantInteractions.size > 0) {
      const updates: IGrant[] = [];
      for (const id of this.newGrantInteractions) {
        const grant = this.grantMap.get(id);
        if (!grant) {
          this._logger.error(
            `Grant ${id} missing from grantMap during flush (interactions)`
          );
          continue;
        }
        updates.push(grant);
      }

      promises.push(this._repo.storeInteractions(updates));
    }

    if (this.updatedGrantInteractions.size > 0) {
      const updates: IGrant[] = [];
      for (const id of this.updatedGrantInteractions) {
        const grant = this.grantMap.get(id);
        if (!grant) {
          this._logger.error(
            `Grant ${id} missing from grantMap during flush (interactions)`
          );
          continue;
        }
        updates.push(grant);
      }

      promises.push(this._repo.storeInteractions(updates));
    }

    if (this.revokedTokens.size > 0) {
      promises.push(
        this._repo.storeRevokedTokens([...this.revokedTokens.values()])
      );
    }

    // TODO handle gracefully
    try {
      await Promise.all(promises);
    } finally {
      this.newGrantIds = [];
      this.continuedGrantIds.clear();
      this.continuedGrantAccessTokens.clear();
      this.revokedTokens.clear();
      this.revokedGrantIds.clear();
      this.grantMap.clear();
      this.grantIdsWithRotatedTokens.clear();
      this.newGrantIds = [];
      this.newGrantInteractions.clear();
      this.updatedGrantInteractions.clear();
      this.finishedInteractiveGrantIds.clear();
      this.clientKeysToResolve = [];
      this.requestIdToClientKeyMap.clear();
      this.requestIdToClientNameMap.clear();
    }
  }
}
