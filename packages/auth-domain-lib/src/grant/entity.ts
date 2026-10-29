import * as crypto from 'crypto';
import { isDeepStrictEqual } from 'util';
import { v4 as uuid } from 'uuid';
import {
  InvalidGrantError,
  InvalidGrantInputError,
  InvalidInteractionError,
  NonInteractiveGrantError,
  UnknownAccessTokenError,
  UnknownInteractionError
} from './errors';
import {
  IAccessItem,
  IFinishMethod,
  FinalizedGrantState,
  GrantState,
  IGrant,
  IInteraction,
  InteractionChoice,
  InteractionState,
  IStartMethod,
  IAccessToken,
  InteractiveAccessType,
  IJsonWebKey,
  AccessAction,
  ISubjectId,
  isJWK,
  AccessType,
  OutgoingPaymentAccessItem,
  ISpentAmounts
} from './interfaces';
import { DateTime, Interval } from 'luxon';
import { getInterval } from './utils';

export const GRANT_POLL_MS = 5_000; // 5 seconds
const INTERACTION_EXPIRY_MS = 600_000; // 10 minutes
const ACCESS_TOKEN_EXPIRY_MS = 10_000; // 10 seconds

interface IGrantInput {
  id: string;
  startMethods?: IStartMethod[];
  continueToken?: string;
  continueId?: string;
  state: GrantState;
  interaction?: IInteraction;
  client?: string | IJsonWebKey;
  clientName?: string;
  subjectIds?: ISubjectId[];
  accesses?: IAccessItem[];
  finishMethod?: IFinishMethod;
  finishUri?: string;
  finishNonce?: string;
  interactionNonce?: string;
  lastContinuedAt?: Date;
}

export type CreateGrantInput = Omit<
  IGrantInput,
  'continueToken' | 'continueId' | 'state'
>;

type SpentAmountType = 'debit' | 'receive';

function generateContinueToken(): string {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
}

function generateAccessToken(): string {
  return crypto.randomBytes(10).toString('hex').toUpperCase();
}

function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
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

export class GrantEntity implements IGrant {
  private _id: string;
  private _createdAt: Date;
  private _startMethods?: IStartMethod[];
  private _continueToken?: string;
  private _continueId?: string;
  private _lastContinuedAt?: Date;
  private _state: GrantState;
  private _client?: string | IJsonWebKey;
  private _clientName?: string;
  private _subjectIds?: ISubjectId[];
  private _accesses?: IAccessItem[];
  private _finishNonce?: string;
  private _finishMethod?: IFinishMethod;
  private _finishUri?: string;
  private _interactionNonce?: string;
  private _interaction?: IInteraction;
  // Map is indexed by the value of the access token.
  private _accessTokens: Map<string, IAccessToken> = new Map<
    string,
    IAccessToken
  >();
  // Spent amounts tracker for grants with outgoing payment accesses.
  private _spentAmounts?: ISpentAmounts;

  private constructor(input: Omit<IGrant, 'state'> & { state?: GrantState }) {
    this._id = input.id;
    this._startMethods = input.startMethods;
    this._continueToken = input.continueToken;
    this._continueId = input.continueId;
    this._lastContinuedAt = input.lastContinuedAt;
    this._state = input.state ?? GrantState.PROCESSING;
    this._client = input.client;
    this._clientName = input.clientName;
    this._subjectIds = input.subjectIds;
    this._accesses = input.accesses;
    this._finishNonce = input.finishNonce;
    this._finishMethod = input.finishMethod;
    this._finishUri = input.finishUri;
    this._interactionNonce = input.interactionNonce;
    this._interaction = input.interaction;
    this._createdAt = input.createdAt;
    this._spentAmounts = input.spentAmounts;

    if (input.accessTokens) {
      for (const accessToken of input.accessTokens) {
        this._accessTokens.set(accessToken.value, accessToken);
      }
    }
  }

  static fromObject(obj: IGrant): GrantEntity {
    return new GrantEntity(obj);
  }

  private isGrantWithSpentAmountsInterval(): boolean {
    return !!this._spentAmounts?.interval;
  }

  // Computes the state of the grant as well as any continuation information
  // depending on the access types requested.
  static create(
    input: Omit<
      IGrant,
      | 'state'
      | 'continueToken'
      | 'continueId'
      | 'lastContinuedAt'
      | 'accessTokens'
      | 'createdAt'
    >
  ): {
    entity: GrantEntity;
    accessToken?: IAccessToken;
  } {
    const createdAt = new Date();

    const isInteractiveGrant = input.accesses?.some((access) =>
      InteractiveAccessType.includes(access.type)
    );

    if (
      isInteractiveGrant &&
      (!input.startMethods?.length || !input.clientName || isJWK(input.client))
    ) {
      throw new InvalidGrantInputError();
    }

    if (isInteractiveGrant) {
      const entity = new GrantEntity({
        ...input,
        createdAt,
        interactionNonce: generateNonce(),
        accessTokens: [],
        // Init spent amounts, as an interactive grant implies outgoing payemnt access type.
        spentAmounts: {
          total: {
            debit: 0n,
            receive: 0n
          }
        }
      });
      entity.stateTransition(GrantState.PENDING);
      return {
        entity
      };
    } else {
      const entity = new GrantEntity({
        ...input,
        createdAt,
        accessTokens: []
      });
      entity.stateTransition(GrantState.ISSUED);

      const accessToken = entity.createAccessToken();
      return { entity, accessToken };
    }
  }

  toObject(): IGrant {
    return {
      id: this._id,
      createdAt: this._createdAt,
      interactionNonce: this._interactionNonce,
      interaction: this._interaction,
      startMethods: this._startMethods,
      continueToken: this._continueToken,
      continueId: this._continueId,
      lastContinuedAt: this._lastContinuedAt,
      state: this._state,
      client: this._client,
      clientName: this._clientName,
      subjectIds: this._subjectIds,
      accesses: this._accesses,
      finishNonce: this._finishNonce,
      finishMethod: this._finishMethod,
      finishUri: this._finishUri,
      accessTokens: Array.from(this._accessTokens.values()),
      spentAmounts: this._spentAmounts
    };
  }

  // Generates an interaction for the grant.
  startInteraction(): IInteraction & {
    nonce: string;
    clientUri: string;
    clientName: string;
  } {
    if (!this._startMethods || !this._interactionNonce) {
      throw new NonInteractiveGrantError();
    }

    if (this._state !== GrantState.PENDING) {
      throw new InvalidGrantError();
    }

    const createdAt = new Date();

    this._interaction = {
      interactRef: uuid(),
      createdAt,
      expiresAt: new Date(createdAt.getTime() + INTERACTION_EXPIRY_MS),
      state: InteractionState.PENDING
    };

    return {
      ...this._interaction,
      nonce: this._interactionNonce,
      clientUri: this._client as string,
      clientName: this._clientName as string
    };
  }

  // Updates the approval state of the interaction.
  handleInteraction(choice: InteractionChoice) {
    if (!this._interaction) {
      throw new UnknownInteractionError();
    }

    if (Date.now() > this._interaction.expiresAt.getTime()) {
      throw new InvalidInteractionError();
    }

    if (this._interaction.state !== InteractionState.PENDING) {
      throw new InvalidInteractionError();
    }

    this._interaction.state = choice;
  }

  finishInteraction(nonce: string): IGrant {
    if (!this._interaction || this._interactionNonce !== nonce) {
      throw new UnknownInteractionError();
    }

    if (this._interaction.state === InteractionState.PENDING) {
      throw new InvalidInteractionError();
    }

    if (this._interaction.state === InteractionState.APPROVED) {
      this.stateTransition(GrantState.APPROVED);
    } else {
      this.stateTransition(GrantState.REJECTED);
    }

    return this.toObject();
  }

  private static readonly STATE_TRANSITIONS: Record<
    GrantState,
    readonly GrantState[]
  > = {
    [GrantState.PROCESSING]: [
      GrantState.PENDING,
      GrantState.ISSUED,
      GrantState.REVOKED
    ],
    [GrantState.PENDING]: [
      GrantState.PENDING,
      GrantState.APPROVED,
      GrantState.ISSUED,
      GrantState.REJECTED,
      GrantState.REVOKED
    ],
    [GrantState.APPROVED]: [GrantState.ISSUED, GrantState.REVOKED],
    [GrantState.ISSUED]: [GrantState.ISSUED, GrantState.REVOKED],
    [GrantState.REJECTED]: [],
    [GrantState.REVOKED]: []
  };

  private stateTransition(newState: GrantState): void {
    const transitions = GrantEntity.STATE_TRANSITIONS[this._state];
    if (!transitions.includes(newState)) {
      throw new InvalidGrantError(
        `Invalid state transition from ${this._state} to ${newState}`
      );
    }

    this._state = newState;

    if (newState in FinalizedGrantState) {
      this._continueToken = undefined;
      this._continueId = undefined;
    } else {
      this._continueToken = generateContinueToken();
      this._continueId = uuid();
      this._lastContinuedAt = new Date();
    }
  }

  private assertContinueCredentials(
    continueToken: string,
    continueId: string
  ): void {
    if (!this._continueToken || !this._continueId) {
      throw new InvalidGrantError(
        `Current state ${this._state} is a finalized state and cannot be changed`
      );
    }

    if (
      continueToken !== this._continueToken ||
      continueId !== this._continueId
    ) {
      throw new InvalidGrantError('Invalid continue token or continue id');
    }
  }

  // Continues the grant, if an interaction was required.
  continue(
    continueToken: string,
    continueId: string,
    interactRef?: string
  ): IAccessToken | undefined {
    this.assertContinueCredentials(continueToken, continueId);

    if (
      this._lastContinuedAt &&
      Date.now() < this._lastContinuedAt.getTime() + GRANT_POLL_MS
    ) {
      throw new InvalidGrantError('Cannot continue grant too soon');
    }

    if (!interactRef) {
      if (this.finishMethod) {
        throw new InvalidGrantError(
          'Grant requires an interaction reference to continue'
        );
      }

      if (
        this._state === GrantState.PENDING ||
        this._state === GrantState.ISSUED
      ) {
        this.stateTransition(this._state);
        return;
      }

      if (this._state === GrantState.APPROVED) {
        this.stateTransition(GrantState.ISSUED);
        return this.createAccessToken();
      }

      throw new InvalidGrantError(
        'Grant is not in a state that can be continued'
      );
    } else {
      if (
        !this._interaction ||
        this._interaction.state === InteractionState.PENDING ||
        this._interaction.interactRef !== interactRef
      ) {
        throw new InvalidInteractionError();
      }

      if (this._state !== GrantState.PENDING) {
        throw new InvalidGrantError(
          'Cannot continue grant that is not in processing or pending state'
        );
      }

      if (this._interaction.state === InteractionState.APPROVED) {
        this.stateTransition(GrantState.ISSUED);
        return this.createAccessToken();
      }

      if (this._interaction.state === InteractionState.REJECTED) {
        this.stateTransition(GrantState.REJECTED);
      }
    }
  }

  revokeAccessTokens(): IAccessToken[] {
    const revokedTokens: IAccessToken[] = [];
    const now = new Date();
    for (const accessToken of this._accessTokens.values()) {
      if (
        !accessToken.revokedAt &&
        accessToken.expiresAt.getTime() >= Date.now()
      ) {
        accessToken.revokedAt = now;
        this._accessTokens.set(accessToken.value, accessToken);
        revokedTokens.push(accessToken);
      }
    }
    return revokedTokens;
  }

  /**
   * 1. Updates the state of the grant if it was not a final state.
   * 2. Revokes any active access tokens on the grant.
   * @param continueToken - The continue token to revoke the grant.
   * @param continueId - The continue id to revoke the grant.
   * @returns The revoked access tokens which will be persisted to the db in the aggregate.
   */
  revoke(continueToken: string, continueId: string): IAccessToken[] {
    this.assertContinueCredentials(continueToken, continueId);

    this.stateTransition(GrantState.REVOKED);

    return this.revokeAccessTokens();
  }

  // Revokes a grant as invoked by an Admin-level request.
  adminRevoke(): IAccessToken[] {
    this.stateTransition(GrantState.REVOKED);
    return this.revokeAccessTokens();
  }

  // Issues a new access token for this grant.
  private createAccessToken(): IAccessToken {
    const createdAt = new Date();
    const newAccessToken: IAccessToken = {
      value: generateAccessToken(),
      managementId: uuid(),
      expiresInMs: ACCESS_TOKEN_EXPIRY_MS,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + ACCESS_TOKEN_EXPIRY_MS)
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
      accessToken.expiresAt.getTime() < Date.now()
    ) {
      return { active: false };
    }

    if (this.state !== GrantState.ISSUED) {
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

      if (allowedAccessItems.length !== requestedAccesses.length)
        return { active: false };
      return { active: true, access: allowedAccessItems };
    } else {
      return { active: true, access: this._accesses };
    }
  }

  revokeAccessToken(value: string, managementId: string): IAccessToken {
    const accessToken = this._accessTokens.get(value);
    if (!accessToken) {
      throw new UnknownAccessTokenError();
    }

    if (accessToken.managementId !== managementId) {
      throw new UnknownAccessTokenError();
    }

    if (!accessToken.revokedAt) {
      accessToken.revokedAt = new Date();
      this._accessTokens.set(value, accessToken);
    }

    return accessToken as IAccessToken;
  }

  rotateAccessToken(value: string, managementId: string): IAccessToken {
    const accessToken = this._accessTokens.get(value);
    if (
      !accessToken ||
      accessToken.revokedAt ||
      accessToken.expiresAt.getTime() < Date.now()
    ) {
      throw new UnknownAccessTokenError();
    }

    if (accessToken.managementId !== managementId) {
      throw new UnknownAccessTokenError();
    }

    this.revokeAccessToken(value, managementId);
    return this.createAccessToken();
  }

  private getOutgoingPaymentAccess(): OutgoingPaymentAccessItem | undefined {
    const outgoingPaymentAccess = this.accesses?.find(
      (access) => access.type === AccessType.OUTGOING_PAYMENT
    );
    return outgoingPaymentAccess as OutgoingPaymentAccessItem;
  }

  private getGrantIntervalString(): string | undefined {
    const outgoingPaymentAccess = this.getOutgoingPaymentAccess();
    if (!outgoingPaymentAccess) return;
    return outgoingPaymentAccess.limits?.interval;
  }

  private getSpentAmountInterval(): Interval {
    if (!this.isGrantWithSpentAmountsInterval()) throw new InvalidGrantError();
    return Interval.fromDateTimes(
      new Date(this._spentAmounts!.interval!.start),
      new Date(this._spentAmounts!.interval!.end)
    );
  }

  private validateSpentAmount(
    amountType: SpentAmountType,
    value: string,
    createdAt: string,
    amountLimit?: bigint
  ): boolean {
    if (!this._spentAmounts) throw new InvalidGrantError();
    if (!amountLimit) return true;
    if (
      !this.getGrantIntervalString() &&
      this._spentAmounts.total[amountType] + BigInt(value) > amountLimit
    ) {
      // Throw if the amount will exceed the grant spend limit and there is no interval.
      throw new InvalidGrantError();
    }

    if (
      this.exceedsCurrentIntervalLimit(
        amountType,
        value,
        amountLimit,
        createdAt
      )
    ) {
      // Throw if the amount will exceed the grant spend limit within the interval, if the payment creation date is within the currently tracked interval..
      throw new InvalidGrantError();
    } else if (this.hasNoFutureIntervalSpendAvailable(createdAt)) {
      // Throw if payment creation date is after the currently tracked interval and is not contained in a subsequent one.
      throw new InvalidGrantError();
    }

    return true;
  }

  // Determines if an outgoing payment was created in the current interval, if the grant has one,
  // and if its desired spend amount will exceed the spend limit in that interval.
  private exceedsCurrentIntervalLimit(
    amountType: SpentAmountType,
    value: string,
    amountLimit: bigint,
    createdAt: string
  ): boolean {
    return !!(
      this._spentAmounts?.interval &&
      this.getSpentAmountInterval().contains(
        DateTime.fromJSDate(new Date(createdAt))
      ) &&
      this._spentAmounts.interval.total[amountType] + BigInt(value) >
        amountLimit
    );
  }

  // Determines if an outgoing payment was created in an interval subsequent to the
  // currently tracked one, if the grant tracks intervals, and if its desired spend amount
  // will exceed the spend limit in that subsequent interval.
  private hasNoFutureIntervalSpendAvailable(createdAt: string): boolean {
    const grantIntervalString = this.getGrantIntervalString();
    return !!(
      this._spentAmounts?.interval &&
      this.getSpentAmountInterval().isBefore(
        DateTime.fromJSDate(new Date(createdAt))
      ) &&
      grantIntervalString &&
      !getInterval(grantIntervalString, new Date(createdAt))
    );
  }

  private updateSpentAmount(
    amountType: 'debit' | 'receive',
    value: string,
    createdAt: string
  ): void {
    if (!this._spentAmounts) {
      throw new InvalidGrantError();
    }
    this._spentAmounts.total[amountType] += BigInt(value);

    if (this._spentAmounts.interval) {
      const spentAmountInterval = this.getSpentAmountInterval();
      if (
        spentAmountInterval.contains(DateTime.fromJSDate(new Date(createdAt)))
      ) {
        this._spentAmounts.interval.total[amountType] += BigInt(value);
      } else {
        const interval = getInterval(
          this.getGrantIntervalString() as string,
          new Date(createdAt)
        );
        const total =
          amountType === 'debit'
            ? { debit: BigInt(value), receive: 0n }
            : { receive: BigInt(value), debit: 0n };
        this._spentAmounts.interval = {
          total,
          start: (
            (interval as Interval).start as DateTime
          ).toMillis() as number,
          end: ((interval as Interval).end as DateTime).toMillis() as number
        };
      }
    } else if (this.getGrantIntervalString()) {
      const interval = getInterval(
        this.getGrantIntervalString() as string,
        new Date(createdAt)
      );
      const total =
        amountType === 'debit'
          ? { debit: BigInt(value), receive: 0n }
          : { receive: BigInt(value), debit: 0n };
      this._spentAmounts.interval = {
        total,
        start: ((interval as Interval).start as DateTime).toMillis() as number,
        end: ((interval as Interval).end as DateTime).toMillis() as number
      };
    }
  }

  validateAndUpdateSpentAmounts(input: {
    receiveAmountValue?: string;
    debitAmountValue?: string;
    createdAt: string;
  }): ISpentAmounts {
    const outgoingPaymentAccessItem = this.getOutgoingPaymentAccess();
    if (!outgoingPaymentAccessItem || !this._spentAmounts)
      throw new InvalidGrantError();

    const { receiveAmountValue, debitAmountValue, createdAt } = input;

    const { limits } = outgoingPaymentAccessItem;
    if (debitAmountValue) {
      if (!limits) this._spentAmounts.total.debit += BigInt(debitAmountValue);
      else {
        this.validateSpentAmount(
          'debit',
          debitAmountValue,
          createdAt,
          limits.debitAmount
        );
        this.updateSpentAmount('debit', debitAmountValue, createdAt);
      }
    }

    if (receiveAmountValue) {
      if (!limits)
        this._spentAmounts.total.receive += BigInt(receiveAmountValue);
      else {
        this.validateSpentAmount(
          'receive',
          receiveAmountValue,
          createdAt,
          limits.receiveAmount
        );
        this.updateSpentAmount('receive', receiveAmountValue, createdAt);
      }
    }

    return this._spentAmounts;
  }

  get id(): string {
    return this._id;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get startMethods(): IStartMethod[] | undefined {
    return this._startMethods;
  }

  get continueToken(): string | undefined {
    return this._continueToken;
  }

  get continueId(): string | undefined {
    return this._continueId;
  }

  get lastContinuedAt(): Date | undefined {
    return this._lastContinuedAt;
  }

  get state(): GrantState {
    return this._state;
  }

  get client(): string | IJsonWebKey | undefined {
    return this._client;
  }

  get clientName(): string | undefined {
    return this._clientName;
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

  get finishNonce(): string | undefined {
    return this._finishNonce;
  }

  get finishUri(): string | undefined {
    return this._finishUri;
  }

  get interactionNonce(): string | undefined {
    return this._interactionNonce;
  }

  get interaction(): IInteraction | undefined {
    return this._interaction;
  }

  get accessTokens(): IAccessToken[] {
    return Array.from(this._accessTokens.values());
  }

  get spentAmounts(): ISpentAmounts | undefined {
    return this._spentAmounts;
  }
}
