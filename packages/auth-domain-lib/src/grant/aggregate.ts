import { ILogger, IMessage } from 'common-types-lib';
import {
  ContinueGrantCmd,
  CreateGrantCmd,
  AcceptInteractionCommand,
  RejectInteractionCommand,
  RevokeGrantCmd,
  IntrospectTokenCmd,
  RotateTokenCmd,
  RevokeTokenCmd
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
  TokenIntrospectionFailedEvent,
  TokenRotatedEvent,
  TokenRotationFailedEvent
} from './events';
import {
  AccessAction,
  AccessType,
  GrantFinalization,
  IAccessItem,
  IAccessLimit,
  IFinishMethod,
  IGrant,
  IGrantRepository,
  IJsonWebKey,
  InteractionChoice,
  InteractionState,
  isJWK,
  IStartMethod,
  ISubjectId,
  IWalletAddressService
} from './interfaces';
import { GrantEntity } from './entity';
import { JWK, validateSignature } from '@interledger/http-signature-utils';

export interface IGrantService {
  fetchByIds(grantIds: string[]): Promise<IGrant[]>;
}

export class GrantAggregate {
  private newGrantIds: string[] = [];
  private grantMap = new Map<string, GrantEntity>();
  private walletAddressRequestMap = new Map<
    string,
    { kid: string; requestId: string }[]
  >();
  private requestIdToClientKeyMap = new Map<string, IJsonWebKey>();

  constructor(
    private _repo: IGrantRepository,
    private _walletAddressService: IWalletAddressService,
    private _logger: ILogger
  ) {}

  async handleBatch(cmds: IMessage[]): Promise<{ events: IMessage[] }> {
    this._logger.debug(`handleBatch — ${cmds.length} cmd(s)`);
    const outputEvents: IMessage[] = [];

    const grantIdSet = new Set<string>();
    const walletAddressSet = new Set<string>();
    for (const cmd of cmds) {
      if (cmd.msgName === CreateGrantCmd.name) {
        const payload = (cmd as CreateGrantCmd).payload;
        grantIdSet.add(payload.id);
        if (!this.parseJWKJson(payload.client)) {
          walletAddressSet.add(payload.client);
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
      } else if (cmd.msgName === ContinueGrantCmd.name) {
        const payload = (cmd as ContinueGrantCmd).payload;
        grantIdSet.add(payload.id);
      } else if (
        cmd.msgName === AcceptInteractionCommand.name ||
        cmd.msgName === RejectInteractionCommand.name
      ) {
        const payload = (
          cmd as AcceptInteractionCommand | RejectInteractionCommand
        ).payload;
        grantIdSet.add(payload.id);
      }

      const grants = await this._repo.fetchByIds([...grantIdSet]);
      const findKeys = async (walletAddress: string): Promise<void> => {
        const keys =
          await this._walletAddressService.getWalletAddressKeys(walletAddress);
        const requestIdAndKid =
          this.walletAddressRequestMap.get(walletAddress) ?? [];

        for (const requested of requestIdAndKid) {
          const key = keys.find((key) => key.kid === requested.kid);
          if (key) this.requestIdToClientKeyMap.set(requested.requestId, key);
        }
      };

      const waRequests = [];
      for (const walletAddress of walletAddressSet) {
        waRequests.push(findKeys(walletAddress));
      }

      await Promise.all(waRequests);

      for (const grant of grants) {
        this.grantMap.set(grant.id, GrantEntity.fromObject(grant));
      }

      for (const cmd of cmds) {
        let event: IMessage;
        if (cmd.msgName == CreateGrantCmd.name) {
          event = await this.handleCreateGrantCommand(cmd as CreateGrantCmd);
        } else if (cmd.msgName === ContinueGrantCmd.name) {
          event = this.handleContinueGrantCommand(cmd as ContinueGrantCmd);
        } else if (cmd.msgName === RevokeGrantCmd.name) {
          event = this.handleRevokeGrantCommand(cmd as RevokeGrantCmd);
        } else if (cmd.msgName === IntrospectTokenCmd.name) {
          event = this.handleIntrospectTokenCommand(cmd as IntrospectTokenCmd);
        } else if (cmd.msgName === RotateTokenCmd.name) {
          event = this.handleRotateTokenCommand(cmd as RotateTokenCmd);
        } else if (cmd.msgName === RevokeTokenCmd.name) {
          event = this.handleRevokeTokenCommand(cmd as RevokeTokenCmd);
        } else if (cmd.msgName === AcceptInteractionCommand.name) {
          event = this.handleAcceptInteractionCommand(
            cmd as AcceptInteractionCommand
          );
        } else if (cmd.msgName === RejectInteractionCommand.name) {
          event = this.handleRejectInteractionCommand(
            cmd as RejectInteractionCommand
          );
        } else {
          this._logger.error(`Received unexpected command: ${cmd.msgName}`);
          continue;
        }

        outputEvents.push(event);
      }
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

      // TODO: pass in finish URI and finish Nonce
      const { entity, accessToken } = GrantEntity.create({
        ...cmd.payload,
        startMethods: cmd.payload.interact?.start as IStartMethod[],
        finishMethod: cmd.payload.interact?.finish?.method as IFinishMethod,
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
          errorName: (err as Error).constructor.name,
          message: (err as Error).message
        },
        cmd.requestId
      );
    }
  }

  private handleContinueGrantCommand(cmd: ContinueGrantCmd) {
    const { id, continueId, continueToken, interactRef } = cmd.payload;
    try {
      const grant = this.grantMap.get(id);
      if (!grant) {
        throw new GrantNotFoundError(`Grant ${id} not found`);
      }

      const accessToken = grant.continue(
        continueToken,
        continueId,
        interactRef
      );

      this.grantMap.set(id, grant);
      return new GrantContinuedEvent({
        id,
        finalizationReason: grant.finalizationReason as GrantFinalization,
        accessTokenValue: accessToken?.value,
        accessTokenManagementId: accessToken?.managementId,
        accessTokenExpiresIn: accessToken?.expiresInMs,
        access: grant.accesses,
        continueId: grant.continueId,
        continueToken: grant.continueToken
      });
    } catch (err) {
      return new GrantContinueFailedEvent({
        grantId: cmd.payload.id,
        errorName: (err as Error).name,
        message: (err as Error).message
      });
    }
  }

  private handleRevokeGrantCommand(cmd: RevokeGrantCmd) {
    const { id, continueId, continueToken } = cmd.payload;

    try {
      const grant = this.grantMap.get(id);
      if (!grant) {
        throw new GrantNotFoundError(`Grant ${id} not found`);
      }

      grant.revoke(continueToken, continueId);

      this.grantMap.set(id, grant);
      return new GrantRevokedEvent({
        id
      });
    } catch (error) {
      return new GrantRevokeFailedEvent({
        grantId: id,
        errorName: (error as Error).name,
        message: (error as Error).message
      });
    }
  }

  private handleIntrospectTokenCommand(cmd: IntrospectTokenCmd) {
    const { id, tokenValue, access } = cmd.payload;
    try {
      const grant = this.grantMap.get(id);
      if (!grant) {
        throw new GrantNotFoundError(`Grant ${id} not found`);
      }

      const accessToken = grant.introspectAccessToken(tokenValue, access);

      this.grantMap.set(id, grant);
      return new TokenIntrospectedEvent({
        id,
        active: accessToken.active,
        access: accessToken.access
      });
    } catch (err) {
      return new TokenIntrospectionFailedEvent({
        grantId: cmd.payload.id,
        errorName: (err as Error).name,
        message: (err as Error).message
      });
    }
  }

  private handleRotateTokenCommand(cmd: RotateTokenCmd) {
    const { id, value, managementId } = cmd.payload;
    try {
      const grant = this.grantMap.get(id);
      if (!grant) {
        throw new GrantNotFoundError(`Grant ${id} not found`);
      }

      const accessToken = grant.rotateAccessToken(value, managementId);

      this.grantMap.set(id, grant);
      return new TokenRotatedEvent({
        id,
        newAccessTokenValue: accessToken.value,
        newAccessTokenManagementId: accessToken.managementId,
        newAccessTokenExpiresIn: accessToken.expiresInMs,
        access: grant.accesses
      });
    } catch (err) {
      return new TokenRotationFailedEvent({
        grantId: cmd.payload.id,
        errorName: (err as Error).name,
        message: (err as Error).message
      });
    }
  }

  private handleRevokeTokenCommand(cmd: RevokeTokenCmd) {
    const { id, value, managementId } = cmd.payload;

    try {
      const grant = this.grantMap.get(id);
      if (!grant) {
        throw new GrantNotFoundError(`Grant ${id} not found`);
      }

      grant.revokeAccessToken(value, managementId);
      this.grantMap.set(id, grant);

      return new GrantRevokedEvent({
        id
      });
    } catch (error) {
      return new GrantRevokeFailedEvent({
        grantId: id,
        errorName: (error as Error).name,
        message: (error as Error).message
      });
    }
  }

  private handleInteractionChoice(
    id: string,
    choice: InteractionChoice,
    interactRef?: string
  ) {
    try {
      const grant = this.grantMap.get(id);
      if (!grant) {
        throw new GrantNotFoundError(`Grant ${id} not found`);
      }

      grant.handleInteractionChoice(choice);
      this.grantMap.set(id, grant);

      return new GrantInteractionChoiceHandledEvent({
        id,
        interactRef
      });
    } catch (error) {
      return new GrantInteractionChoiceFailedEvent({
        grantId: id,
        errorName: (error as Error).name,
        message: (error as Error).message
      });
    }
  }

  private handleAcceptInteractionCommand(cmd: AcceptInteractionCommand) {
    const { id, interactRef } = cmd.payload;

    return this.handleInteractionChoice(
      id,
      InteractionState.APPROVED,
      interactRef
    );
  }

  private handleRejectInteractionCommand(cmd: RejectInteractionCommand) {
    const { id, interactRef } = cmd.payload;

    return this.handleInteractionChoice(
      id,
      InteractionState.DENIED,
      interactRef
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

        newEntities.push(grant);
      }

      promises.push(this._repo.storeMany(newEntities));
    }

    // TODO handle gracefully
    try {
      await Promise.all(promises);
    } finally {
      this.grantMap.clear();
    }
  }
}
