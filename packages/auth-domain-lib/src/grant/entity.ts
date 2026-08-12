import * as crypto from 'crypto';
import { isDeepStrictEqual } from 'util';
import { v4 as uuid } from 'uuid';

import {
  InvalidGrantError,
  InvalidInteractionError,
  NonInteractiveGrantError,
  UnknownAccessTokenError,
  UnknownInteractionError
} from './errors';
import {
  IAccessItem,
  IFinishMethod,
  GrantState,
  IGrant,
  IInteraction,
  InteractionState,
  InteractionChoice,
  IStartMethod,
  IAccessToken,
  NewAccessToken,
  RevokedAccessToken,
  GrantFinalization,
  InteractiveAccessType,
  IJsonWebKey,
  AccessAction,
  ISubjectId
} from './interfaces';

interface IGrantInput {
  id: string;
  startMethods: IStartMethod[];
  continueToken?: string;
  continueId?: string;
  state: GrantState;
  finalizationReason?: GrantFinalization;
  interaction?: IInteraction;
  client?: string | IJsonWebKey;
  subjectIds?: ISubjectId[];
  accesses?: IAccessItem[];
  finishMethod?: IFinishMethod;
  finishUri?: string;
  finishNonce?: string;
  interactionNonce?: string;
  lastContinuedAt?: Date;
  accessTokens?: IAccessToken[];
}

export type CreateGrantInput = Omit<
  IGrantInput,
  'continueToken' | 'continueId' | 'state'
>;

function generateContinueToken(): string {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
}

function generateAccessToken(): string {
  return crypto.randomBytes(10).toString('hex').toUpperCase();
}

function compareAccessItems(
  inputAccessItem: IAccessItem,
  grantAccessItem: IAccessItem
): boolean {
  if (inputAccessItem.type !== grantAccessItem.type) return false;

  for (const inputAction of inputAccessItem.actions) {
    if (
      !grantAccessItem.actions.find(
        (grantAction) =>
          inputAction === grantAction ||
          (inputAction === AccessAction.READ &&
            grantAction === AccessAction.READ_ALL) ||
          (inputAction === AccessAction.LIST &&
            grantAction === AccessAction.LIST_ALL)
      )
    )
      return false;
  }

  if (inputAccessItem.identifier !== grantAccessItem.identifier) return false;

  if (
    inputAccessItem.limits &&
    !isDeepStrictEqual(inputAccessItem.limits, grantAccessItem.limits)
  )
    return false;
  return true;
}

const GRANT_POLL_MS = 5_000; // 5 seconds
const INTERACTION_EXPIRY_MS = 10_000; // 10 seconds
const ACCESS_TOKEN_EXPIRY_MS = 10_000; // 10 seconds

export class GrantEntity implements IGrant {
  private _id: string;
  private _startMethods: IStartMethod[];
  private _continueToken?: string;
  private _continueId?: string;
  private _state: GrantState;
  private _finalizationReason?: GrantFinalization;
  private _client?: string | IJsonWebKey;
  private _subjectIds?: ISubjectId[];
  private _accesses?: IAccessItem[];
  private _finishNonce?: string;
  private _finishMethod?: IFinishMethod;
  private _finishUri?: string;
  private _interactionNonce?: string;
  private _interaction?: IInteraction;
  private _lastContinuedAt?: Date;
  // Map is indexed by the value of the access token.
  private _accessTokens: Map<string, IAccessToken> = new Map<
    string,
    IAccessToken
  >();

  private constructor(input: IGrantInput) {
    this._id = input.id;
    this._startMethods = input.startMethods;
    this._continueToken = input.continueToken;
    this._continueId = input.continueId;
    this._state = input.state;
    this._finalizationReason = input.finalizationReason;
    this._client = input.client;
    this._subjectIds = input.subjectIds;
    this._accesses = input.accesses;
    this._finishNonce = input.finishNonce;
    this._finishMethod = input.finishMethod;
    this._finishUri = input.finishUri;
    this._interactionNonce = input.interactionNonce;
    this._interaction = input.interaction;
    this._lastContinuedAt = input.lastContinuedAt;

    if (input.accessTokens) {
      for (const accessToken of input.accessTokens) {
        this._accessTokens.set(accessToken.value, accessToken);
      }
    }
  }

  static fromObject(obj: IGrant): GrantEntity {
    return new GrantEntity(obj);
  }

  // Computes the state of the grant as well as any continuation information
  // depending on the access types requested.
  static create(input: CreateGrantInput): {
    entity: GrantEntity;
    accessToken?: IAccessToken;
  } {
    const isContinuableGrant = input.accesses?.some((access) =>
      InteractiveAccessType.includes(access.type)
    );

    if (isContinuableGrant) {
      const entity = new GrantEntity({
        ...input,
        state: GrantState.PENDING,
        continueToken: generateContinueToken(),
        continueId: uuid(),
        interactionNonce: crypto.randomBytes(16).toString('hex').toUpperCase()
      });

      return {
        entity
      };
    } else {
      const entity = new GrantEntity({
        ...input,
        state: GrantState.FINALIZED,
        finalizationReason: GrantFinalization.ISSUED
      });

      const accessToken = entity.createAccessToken();
      return { entity, accessToken };
    }
  }

  toObject(): IGrant {
    return {
      id: this._id,
      interactionNonce: this._interactionNonce,
      interaction: this._interaction,
      startMethods: this._startMethods,
      continueToken: this._continueToken,
      continueId: this._continueId,
      state: this._state,
      finalizationReason: this._finalizationReason,
      client: this._client,
      subjectIds: this._subjectIds,
      accesses: this._accesses,
      finishNonce: this._finishNonce,
      finishMethod: this._finishMethod,
      finishUri: this._finishUri,
      lastContinuedAt: this._lastContinuedAt,
      accessTokens: Array.from(this._accessTokens.values())
    };
  }

  // Generates an interaction for the grant.
  startInteraction(clientNonce: string): IInteraction {
    if (!this._startMethods) {
      throw new NonInteractiveGrantError();
    }

    this._interaction = {
      clientNonce,
      interactRef: uuid(),
      expiresInMs: INTERACTION_EXPIRY_MS,
      state: InteractionState.PENDING
    };

    return this._interaction;
  }

  // Updates the approval state of the interaction.
  handleInteractionChoice(choice: InteractionChoice) {
    if (!this._interaction) {
      throw new UnknownInteractionError();
    }

    if (this._interaction.state !== InteractionState.PENDING)
      throw new InvalidInteractionError();

    this._interaction.state = choice;
  }

  // Continues the grant, if an interaction was required.
  continue(
    continueToken: string,
    continueId: string,
    interactRef: string
  ): NewAccessToken | undefined {
    if (
      continueToken !== this.continueToken ||
      continueId !== this.continueId
    ) {
      throw new InvalidGrantError();
    }

    if (
      this._lastContinuedAt &&
      this._lastContinuedAt.getTime() + GRANT_POLL_MS < Date.now()
    ) {
      this._lastContinuedAt = new Date();
      throw new InvalidGrantError('Cannot continue grant too soon');
    }

    this._lastContinuedAt = new Date();

    if (
      !this._interaction ||
      this._interaction.interactRef !== interactRef ||
      this._interaction.state === InteractionState.PENDING
    ) {
      throw new InvalidInteractionError();
    }

    if (
      this._state !== GrantState.PROCESSING &&
      this._state !== GrantState.PENDING
    ) {
      throw new InvalidGrantError(
        'Cannot continue grant that is not in processing or pending state'
      );
    }

    if (this._interaction.state === InteractionState.APPROVED) {
      this._state = GrantState.FINALIZED;
      this._finalizationReason = GrantFinalization.ISSUED;

      return this.createAccessToken();
    } else if (this._interaction.state === InteractionState.DENIED) {
      this._state = GrantState.FINALIZED;
      this._finalizationReason = GrantFinalization.REJECTED;
    }
  }

  revoke(continueToken: string, continueId: string) {
    if (continueToken !== this.continueToken || continueId !== this.continueId)
      throw new InvalidGrantError('Invalid continue token or continue id');

    if (this._state !== GrantState.FINALIZED) {
      throw new InvalidGrantError('Cannot revoke finalized grant');
    }
    this._state = GrantState.FINALIZED;
    this._finalizationReason = GrantFinalization.REVOKED;
  }

  // Issues a new access token for this grant.
  createAccessToken(): NewAccessToken {
    if (this.finalizationReason !== GrantFinalization.ISSUED) {
      throw new InvalidGrantError(
        'Cannot create access token for grant that has not been issued'
      );
    }
    const newAccessToken: NewAccessToken = {
      managementId: uuid(),
      value: generateAccessToken(),
      createdAt: new Date(),
      expiresInMs: ACCESS_TOKEN_EXPIRY_MS
    };
    this._accessTokens.set(newAccessToken.value, newAccessToken);
    return newAccessToken;
  }

  // Introspect an access token.
  // Returns an active boolean, and if true,
  // then the union between the requested accesses and the grant's accesses.
  introspectAccessToken(
    value: string,
    requestedAccesses?: IAccessItem[]
  ): { active: boolean; access?: IAccessItem[] } {
    const accessToken = this._accessTokens.get(value);
    if (
      !accessToken ||
      accessToken.revokedAt ||
      accessToken.createdAt.getTime() + accessToken.expiresInMs < Date.now()
    ) {
      return { active: false };
    }

    if (this.finalizationReason !== GrantFinalization.ISSUED) {
      return { active: false };
    }

    if (requestedAccesses) {
      const allowedAccessItems: IAccessItem[] = [];
      for (const requestedAccessItem of requestedAccesses) {
        const allowedAccessItem = this._accesses?.find((grantAccessItem) =>
          compareAccessItems(requestedAccessItem, grantAccessItem)
        );
        if (allowedAccessItem) {
          allowedAccessItems.push(allowedAccessItem);
        }
      }

      if (allowedAccessItems.length === requestedAccesses.length)
        return { active: false };
      return { active: true, access: allowedAccessItems };
    } else {
      return { active: true, access: this._accesses };
    }
  }

  revokeAccessToken(value: string, managementId: string): RevokedAccessToken {
    const accessToken = this._accessTokens.get(value);
    if (!accessToken) {
      throw new UnknownAccessTokenError();
    }

    if (accessToken.managementId !== managementId) {
      throw new UnknownAccessTokenError();
    }

    accessToken.revokedAt = new Date();
    this._accessTokens.set(value, accessToken);
    return accessToken as RevokedAccessToken;
  }

  rotateAccessToken(value: string, managementId: string): NewAccessToken {
    if (
      this.state !== GrantState.FINALIZED &&
      this.finalizationReason !== GrantFinalization.ISSUED
    ) {
      throw new InvalidGrantError();
    }

    const accessToken = this._accessTokens.get(value);
    if (!accessToken) {
      throw new UnknownAccessTokenError();
    }

    if (accessToken.managementId !== managementId) {
      throw new UnknownAccessTokenError();
    }

    this.revokeAccessToken(value, managementId);
    return this.createAccessToken();
  }

  get id(): string {
    return this._id;
  }

  get startMethods(): IStartMethod[] {
    return this._startMethods;
  }

  get continueToken(): string | undefined {
    return this._continueToken;
  }

  get continueId(): string | undefined {
    return this._continueId;
  }

  get state(): GrantState {
    return this._state;
  }

  get finalizationReason(): GrantFinalization | undefined {
    return this._finalizationReason;
  }

  get client(): string | IJsonWebKey | undefined {
    return this._client;
  }

  get subjectIds(): ISubjectId[] | undefined {
    return this._subjectIds;
  }

  get accesses(): IAccessItem[] | undefined {
    return this._accesses;
  }

  get finishMethod(): IFinishMethod | undefined {
    return this._finishMethod;
  }

  get interactionNonce(): string | undefined {
    return this._interactionNonce;
  }

  get interaction(): IInteraction | undefined {
    return this._interaction;
  }

  get lastContinuedAt(): Date | undefined {
    return this._lastContinuedAt;
  }

  get accessTokens(): IAccessToken[] {
    return Array.from(this._accessTokens.values());
  }
}
