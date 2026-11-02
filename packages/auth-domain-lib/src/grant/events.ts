import { DomainEventTopics, DomainEvent, AppErrorType } from 'common-types-lib';
import {
  GrantState,
  IAccessItem,
  IJsonWebKey,
  ISubjectId,
  InteractionChoice,
  InteractionState
} from './interfaces';

const BOUNDED_CONTEXT_NAME = 'auth';
const AGGREGATE_NAME = 'grant';

interface GrantDomainErrorPayload {
  grantId: string;
  errorName: string;
  errorType: AppErrorType;
  message: string;
}

export abstract class AuthDomainEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  aggregateId: string;
  msgKey: string;
  msgTopic: string = DomainEventTopics.AuthEvents;
  isErrorEvent: boolean = false;

  protected constructor(aggId: string, requestId?: string) {
    super(aggId);
    this.aggregateId = this.msgKey = aggId;
    this.requestId = requestId;
  }

  static isGrantCreatedEvent(evt: DomainEvent): evt is GrantCreatedEvent {
    return evt.msgName === GrantCreatedEvent.name;
  }

  static isGrantCreateFailedEvent(
    evt: DomainEvent
  ): evt is GrantCreateFailedEvent {
    return evt.msgName === GrantCreateFailedEvent.name;
  }

  static isGrantContinuedEvent(evt: DomainEvent): evt is GrantContinuedEvent {
    return evt.msgName === GrantContinuedEvent.name;
  }

  static isGrantContinueFailedEvent(
    evt: DomainEvent
  ): evt is GrantContinueFailedEvent {
    return evt.msgName === GrantContinueFailedEvent.name;
  }

  static isGrantRevokedEvent(evt: DomainEvent): evt is GrantRevokedEvent {
    return evt.msgName === GrantRevokedEvent.name;
  }

  static isGrantRevokeFailedEvent(
    evt: DomainEvent
  ): evt is GrantRevokeFailedEvent {
    return evt.msgName === GrantRevokeFailedEvent.name;
  }

  static isTokenIntrospectedEvent(
    evt: DomainEvent
  ): evt is TokenIntrospectedEvent {
    return evt.msgName === TokenIntrospectedEvent.name;
  }

  static isTokenRotatedEvent(evt: DomainEvent): evt is TokenRotatedEvent {
    return evt.msgName === TokenRotatedEvent.name;
  }

  static isTokenRotationFailedEvent(
    evt: DomainEvent
  ): evt is TokenRotationFailedEvent {
    return evt.msgName === TokenRotationFailedEvent.name;
  }

  static isTokenRevokedEvent(evt: DomainEvent): evt is TokenRevokedEvent {
    return evt.msgName === TokenRevokedEvent.name;
  }

  static isTokenRevokeFailedEvent(
    evt: DomainEvent
  ): evt is TokenRevokeFailedEvent {
    return evt.msgName === TokenRevokeFailedEvent.name;
  }

  static isGrantInteractionStartedEvent(
    evt: DomainEvent
  ): evt is GrantInteractionStartedEvent {
    return evt.msgName === GrantInteractionStartedEvent.name;
  }

  static isGrantInteractionStartFailedEvent(
    evt: DomainEvent
  ): evt is GrantInteractionStartFailedEvent {
    return evt.msgName === GrantInteractionStartFailedEvent.name;
  }

  static isGrantInteractionFinishedEvent(
    evt: DomainEvent
  ): evt is GrantInteractionFinishedEvent {
    return evt.msgName === GrantInteractionFinishedEvent.name;
  }

  static isGrantInteractionFinishFailedEvent(
    evt: DomainEvent
  ): evt is GrantInteractionFinishFailedEvent {
    return evt.msgName === GrantInteractionFinishFailedEvent.name;
  }

  static isGrantInteractionChoiceHandledEvent(
    evt: DomainEvent
  ): evt is GrantInteractionChoiceHandledEvent {
    return evt.msgName === GrantInteractionChoiceHandledEvent.name;
  }

  static isGrantInteractionChoiceFailedEvent(
    evt: DomainEvent
  ): evt is GrantInteractionChoiceFailedEvent {
    return evt.msgName === GrantInteractionChoiceFailedEvent.name;
  }
}

export interface GrantCreatedPayload {
  id: string;
  continueId?: string;
  continueToken?: string;
  continueWaitMs?: number;
  interactionNonce?: string;
  accessTokenValue?: string;
  accessTokenManagementId?: string;
  accessTokenExpiresIn?: number;
  access?: IAccessItem[];
  subjectIds?: ISubjectId[];
}

export class GrantCreatedEvent extends AuthDomainEvent {
  payload: GrantCreatedPayload;

  constructor(payload: GrantCreatedPayload, requestId?: string) {
    super(payload.id, requestId);
    this.isErrorEvent = false;
    this.payload = payload;
  }
}

export type GrantCreateFailedPayload = GrantDomainErrorPayload;

export class GrantCreateFailedEvent extends AuthDomainEvent {
  payload: GrantCreateFailedPayload;

  constructor(payload: GrantCreateFailedPayload, requestId?: string) {
    super(payload.grantId, requestId);
    this.isErrorEvent = true;
    this.payload = payload;
  }
}

export interface GrantContinuedPayload {
  id: string;
  state: GrantState;
  accessTokenValue?: string;
  accessTokenManagementId?: string;
  accessTokenExpiresIn?: number;
  access?: IAccessItem[];
  continueId?: string;
  continueToken?: string;
  continueWaitMs?: number;
}

export class GrantContinuedEvent extends AuthDomainEvent {
  payload: GrantContinuedPayload;

  constructor(payload: GrantContinuedPayload, requestId?: string) {
    super(payload.id, requestId);
    this.isErrorEvent = false;
    this.payload = payload;
  }
}

export type GrantContinueFailedPayload = GrantDomainErrorPayload;

export class GrantContinueFailedEvent extends AuthDomainEvent {
  payload: GrantContinueFailedPayload;

  constructor(payload: GrantContinueFailedPayload, requestId?: string) {
    super(payload.grantId);
    this.aggregateId = this.msgKey = payload.grantId;
    this.payload = payload;
    this.requestId = requestId;
  }
}

export interface GrantRevokedPayload {
  id: string;
  createdAt: Date;
  status: GrantState;
  access?: IAccessItem[];
  client?: string | IJsonWebKey;
  clientName?: string;
  subjectIds?: ISubjectId[];
  interaction?: {
    state: InteractionState;
    createdAt: Date;
  };
}

export class GrantRevokedEvent extends AuthDomainEvent {
  payload: GrantRevokedPayload;

  constructor(payload: GrantRevokedPayload, requestId: string) {
    super(payload.id, requestId);
    this.payload = payload;
  }
}

export type GrantRevokeFailedPayload = GrantDomainErrorPayload;

export class GrantRevokeFailedEvent extends AuthDomainEvent {
  payload: GrantRevokeFailedPayload;

  constructor(payload: GrantRevokeFailedPayload, requestId: string) {
    super(payload.grantId, requestId);
    this.isErrorEvent = true;
    this.payload = payload;
  }
}

export interface TokenIntrospectedPayload {
  id: string;
  value: string;
  active: boolean;
  access?: IAccessItem[];
}

export class TokenIntrospectedEvent extends AuthDomainEvent {
  payload: TokenIntrospectedPayload;
  requestId: string;

  constructor(payload: TokenIntrospectedPayload, requestId: string) {
    super(payload.id);
    this.aggregateId = this.msgKey = payload.id;
    this.payload = payload;
    this.requestId = requestId;
  }
}

export interface TokenRotatedPayload {
  id: string;
  newAccessTokenValue: string;
  newAccessTokenManagementId: string;
  newAccessTokenExpiresIn: number;
  access?: IAccessItem[];
}

export class TokenRotatedEvent extends AuthDomainEvent {
  payload: TokenRotatedPayload;

  constructor(payload: TokenRotatedPayload, requestId: string) {
    super(payload.id, requestId);
    this.isErrorEvent = false;
    this.payload = payload;
  }
}

export type TokenRotationFailedPayload = GrantDomainErrorPayload;

export class TokenRotationFailedEvent extends AuthDomainEvent {
  payload: TokenRotationFailedPayload;

  constructor(payload: TokenRotationFailedPayload, requestId: string) {
    super(payload.grantId, requestId);
    this.isErrorEvent = true;
    this.payload = payload;
  }
}

export interface GrantInteractionStartedPayload {
  id: string;
  nonce: string;
  clientUri: string;
  clientName: string;
}

export class GrantInteractionStartedEvent extends AuthDomainEvent {
  payload: GrantInteractionStartedPayload;

  constructor(payload: GrantInteractionStartedPayload, requestId: string) {
    super(payload.id, requestId);
    this.isErrorEvent = false;
    this.payload = payload;
  }
}

export type GrantInteractionStartFailedPayload = GrantDomainErrorPayload;

export class GrantInteractionStartFailedEvent extends AuthDomainEvent {
  payload: GrantInteractionStartFailedPayload;

  constructor(payload: GrantInteractionStartFailedPayload, requestId: string) {
    super(payload.grantId, requestId);
    this.isErrorEvent = true;
    this.payload = payload;
    this.requestId = requestId;
  }
}

export interface TokenRevokedPayload {
  id: string;
}

export class TokenRevokedEvent extends AuthDomainEvent {
  payload: TokenRevokedPayload;

  constructor(payload: TokenRevokedPayload, requestId: string) {
    super(payload.id, requestId);
    this.payload = payload;
    this.requestId = requestId;
  }
}

export type TokenRevokeFailedPayload = GrantDomainErrorPayload;

export class TokenRevokeFailedEvent extends AuthDomainEvent {
  payload: TokenRevokeFailedPayload;

  constructor(payload: TokenRevokeFailedPayload, requestId: string) {
    super(payload.grantId, requestId);
    this.isErrorEvent = true;
    this.payload = payload;
  }
}

export interface GrantInteractionFinishedPayload {
  id: string;
  interactNonce: string;
  clientNonce: string;
  interactRef: string;
  clientFinishUri?: string;
}

export class GrantInteractionFinishedEvent extends AuthDomainEvent {
  payload: GrantInteractionFinishedPayload;

  constructor(payload: GrantInteractionFinishedPayload, requestId?: string) {
    super(payload.id, requestId);
    this.payload = payload;
  }
}

export type GrantInteractionFinishFailedPayload = GrantDomainErrorPayload;

export class GrantInteractionFinishFailedEvent extends AuthDomainEvent {
  payload: GrantInteractionFinishFailedPayload;
  isErrorEvent = true;

  constructor(
    payload: GrantInteractionFinishFailedPayload,
    requestId?: string
  ) {
    super(payload.grantId, requestId);
    this.aggregateId = this.msgKey = payload.grantId;
    this.payload = payload;
  }
}

export interface GrantInteractionChoiceHandledPayload {
  id: string;
  choice: InteractionChoice;
}

export class GrantInteractionChoiceHandledEvent extends AuthDomainEvent {
  payload: GrantInteractionChoiceHandledPayload;

  constructor(
    payload: GrantInteractionChoiceHandledPayload,
    requestId?: string
  ) {
    super(payload.id, requestId);
    this.isErrorEvent = false;
    this.payload = payload;
  }
}

export type GrantInteractionChoiceFailedPayload = GrantDomainErrorPayload;

export class GrantInteractionChoiceFailedEvent extends AuthDomainEvent {
  payload: GrantInteractionChoiceFailedPayload;

  constructor(
    payload: GrantInteractionChoiceFailedPayload,
    requestId?: string
  ) {
    super(payload.grantId, requestId);
    this.isErrorEvent = true;
    this.payload = payload;
  }
}
