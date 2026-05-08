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
  ISubject,
  IGrantEntity,
  IAccessToken,
  NewAccessToken,
  RevokedAccessToken,
  GrantFinalization,
  InteractiveAccessType,
  IJsonWebKey,
  AccessAction
} from './interfaces';

interface IGrantInput {
  id: string;
  startMethods: IStartMethod[];
  identifier: string;
  continueToken?: string;
  continueId?: string;
  state: GrantState;
  finalizationReason?: GrantFinalization;
  interaction?: IInteraction;
  client?: string;
  subject?: ISubject;
  accesses?: IAccessItem[];
  finishMethod?: IFinishMethod;
  finishUri?: string;
  lastContinuedAt?: Date;
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

export class GrantEntity implements IGrantEntity {
  private _id: string;
  private _startMethods: IStartMethod[];
  private _identifier: string;
  private _continueToken?: string;
  private _continueId?: string;
  private _state: GrantState;
  private _finalizationReason?: GrantFinalization;
  private _client?: string | IJsonWebKey;
  private _subject?: ISubject;
  private _accesses?: IAccessItem[];
  private _finishMethod?: IFinishMethod;
  private _finishUri?: string;
  private _interaction?: IInteraction;
  private _lastContinuedAt?: Date;
  private _accessTokens: Map<string, IAccessToken> = new Map<
    string,
    IAccessToken
  >();

  private constructor(input: IGrantInput) {
    this._id = input.id;
    this._startMethods = input.startMethods;
    this._identifier = input.identifier;
    this._continueToken = input.continueToken;
    this._continueId = input.continueId;
    this._state = input.state;
    this._finalizationReason = input.finalizationReason;
    this._client = input.client;
    this._subject = input.subject;
    this._accesses = input.accesses;
    this._finishMethod = input.finishMethod;
    this._finishUri = input.finishUri;
    this._interaction = input.interaction;
    this._lastContinuedAt = input.lastContinuedAt;
  }

  static fromObject(obj: IGrantInput): GrantEntity {
    return new GrantEntity(obj);
  }

  // Computes the state of the grant as well as any continuation information
  // depending on the access types requested.
  static create(input: CreateGrantInput): GrantEntity {
    const isContinuableGrant = input.accesses?.some((access) =>
      InteractiveAccessType.includes(access.type)
    );

    const entity = new GrantEntity({
      ...input,
      state: isContinuableGrant ? GrantState.PENDING : GrantState.FINALIZED,
      finalizationReason: !isContinuableGrant
        ? GrantFinalization.ISSUED
        : undefined,
      continueToken: isContinuableGrant ? generateContinueToken() : undefined,
      continueId: isContinuableGrant ? uuid() : undefined
    });

    if (!isContinuableGrant) {
      entity.createAccessToken();
    }

    return entity;
  }

  toObject(): IGrant {
    return {
      id: this._id,
      interaction: this._interaction,
      startMethods: this._startMethods,
      identifier: this._identifier,
      continueToken: this._continueToken,
      continueId: this._continueId,
      state: this._state,
      finalizationReason: this._finalizationReason,
      client: this._client,
      subject: this._subject,
      accesses: this._accesses,
      finishMethod: this._finishMethod,
      finishUri: this._finishUri,
      lastContinuedAt: this._lastContinuedAt,
      accessTokens: this._accessTokens
    };
  }

  // Generates an interaction for the grant.
  startInteraction(): IInteraction {
    if (!this._startMethods) {
      throw new NonInteractiveGrantError();
    }

    this._interaction = {
      interactRef: uuid(),
      clientNonce: crypto.randomBytes(16).toString('hex').toUpperCase(),
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
  continueGrant(
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

  revokeAccessToken(value: string): RevokedAccessToken {
    const accessToken = this._accessTokens.get(value);
    if (!accessToken) {
      throw new UnknownAccessTokenError();
    }
    accessToken.revokedAt = new Date();
    this._accessTokens.set(value, accessToken);
    return accessToken as RevokedAccessToken;
  }

  rotateAccessToken(value: string): NewAccessToken {
    if (this.state !== GrantState.APPROVED) {
      throw new InvalidGrantError();
    }
    this.revokeAccessToken(value);
    return this.createAccessToken();
  }

  get startMethods(): IStartMethod[] {
    return this._startMethods;
  }

  get identifier(): string {
    return this._identifier;
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

  get subject(): ISubject | undefined {
    return this._subject;
  }

  get accesses(): IAccessItem[] | undefined {
    return this._accesses;
  }

  get finishMethod(): IFinishMethod | undefined {
    return this._finishMethod;
  }

  get interaction(): IInteraction | undefined {
    return this._interaction;
  }

  get lastContinuedAt(): Date | undefined {
    return this._lastContinuedAt;
  }

  get accessTokens(): Map<string, IAccessToken> {
    return this._accessTokens;
  }
}
