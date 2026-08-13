import { DomainEventTopics, DomainEvent } from 'common-types-lib';
import { GrantFinalization, IAccessItem, ISubjectId } from './interfaces';

const BOUNDED_CONTEXT_NAME = 'auth';
const AGGREGATE_NAME = 'grant';

export abstract class GrantDomainEvent extends DomainEvent {
  msgTopic: string = DomainEventTopics.AuthEvents;
  isErrorEvent = false;

  protected constructor(aggId: string) {
    super(aggId);
    this.msgKey = aggId;
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

  static isTokenIntrospectionFailedEvent(
    evt: DomainEvent
  ): evt is TokenIntrospectionFailedEvent {
    return evt.msgName === TokenIntrospectionFailedEvent.name;
  }

  static isTokenRotatedEvent(evt: DomainEvent): evt is TokenRotatedEvent {
    return evt.msgName === TokenRotatedEvent.name;
  }

  static isTokenRotationFailedEvent(
    evt: DomainEvent
  ): evt is TokenRotationFailedEvent {
    return evt.msgName === TokenRotationFailedEvent.name;
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
  interactionNonce?: string;
  accessTokenValue?: string;
  accessTokenManagementId?: string;
  accessTokenExpiresIn?: number;
  access?: IAccessItem[];
  subjectIds?: ISubjectId[];
}

export class GrantCreatedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateId: string;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = DomainEventTopics.AuthEvents;
  payload: GrantCreatedPayload;

  constructor(payload: GrantCreatedPayload, requestId?: string) {
    super(payload.id);
    this.aggregateId = this.msgKey = payload.id;
    this.payload = payload;
    this.requestId = requestId;
  }
}

export interface GrantCreateFailedPayload {
  grantId: string;
  errorName: string;
  message: string;
}

export class GrantCreateFailedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = DomainEventTopics.AuthEvents;
  isErrorEvent: boolean = true;
  payload: GrantCreateFailedPayload;

  constructor(payload: GrantCreateFailedPayload, requestId?: string) {
    super(payload.grantId);
    this.aggregateId = this.msgKey = payload.grantId;
    this.payload = payload;
    this.requestId = requestId;
  }
}

export interface GrantContinuedPayload {
  id: string;
  finalizationReason: GrantFinalization;
  accessTokenValue?: string;
  accessTokenManagementId?: string;
  accessTokenExpiresIn?: number;
  access?: IAccessItem[];
  continueId?: string;
  continueToken?: string;
}

export class GrantContinuedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateId: string;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = DomainEventTopics.AuthEvents;
  payload: GrantContinuedPayload;

  constructor(payload: GrantContinuedPayload, requestId?: string) {
    super(payload.id);
    this.aggregateId = this.msgKey = payload.id;
    this.payload = payload;
    this.requestId = requestId;
  }
}

export interface GrantContinueFailedPayload {
  grantId: string;
  errorName: string;
  message: string;
}

export class GrantContinueFailedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateId: string;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = DomainEventTopics.AuthEvents;
  payload: GrantContinueFailedPayload;

  constructor(payload: GrantContinueFailedPayload) {
    super(payload.grantId);
    this.aggregateId = this.msgKey = payload.grantId;
    this.payload = payload;
  }
}

export interface GrantRevokedPayload {
  id: string;
}

export class GrantRevokedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateId: string;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = DomainEventTopics.AuthEvents;
  payload: GrantRevokedPayload;

  constructor(payload: GrantRevokedPayload) {
    super(payload.id);
    this.aggregateId = this.msgKey = payload.id;
    this.payload = payload;
  }
}

export interface GrantRevokeFailedPayload {
  grantId: string;
  errorName: string;
  message: string;
}

export class GrantRevokeFailedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateId: string;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = DomainEventTopics.AuthEvents;
  payload: GrantRevokeFailedPayload;

  constructor(payload: GrantRevokeFailedPayload) {
    super(payload.grantId);
    this.aggregateId = this.msgKey = payload.grantId;
    this.payload = payload;
  }
}

export interface TokenIntrospectedPayload {
  id: string;
  active: boolean;
  access?: IAccessItem[];
}

export class TokenIntrospectedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateId: string;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = DomainEventTopics.AuthEvents;
  payload: TokenIntrospectedPayload;

  constructor(payload: TokenIntrospectedPayload) {
    super(payload.id);
    this.aggregateId = this.msgKey = payload.id;
    this.payload = payload;
  }
}

export interface TokenIntrospectionFailedPayload {
  grantId: string;
  errorName: string;
  message: string;
}

export class TokenIntrospectionFailedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateId: string;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = DomainEventTopics.AuthEvents;
  payload: TokenIntrospectionFailedPayload;

  constructor(payload: TokenIntrospectionFailedPayload) {
    super(payload.grantId);
    this.aggregateId = this.msgKey = payload.grantId;
    this.payload = payload;
  }
}

export interface TokenRotatedPayload {
  id: string;
  newAccessTokenValue: string;
  newAccessTokenManagementId: string;
  newAccessTokenExpiresIn: number;
  access?: IAccessItem[];
}

export class TokenRotatedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateId: string;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = DomainEventTopics.AuthEvents;
  payload: TokenRotatedPayload;

  constructor(payload: TokenRotatedPayload) {
    super(payload.id);
    this.aggregateId = this.msgKey = payload.id;
    this.payload = payload;
  }
}

export interface TokenRotationFailedPayload {
  grantId: string;
  errorName: string;
  message: string;
}

export class TokenRotationFailedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateId: string;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = DomainEventTopics.AuthEvents;
  payload: TokenRotationFailedPayload;

  constructor(payload: TokenRotationFailedPayload) {
    super(payload.grantId);
    this.aggregateId = this.msgKey = payload.grantId;
    this.payload = payload;
  }
}

export interface GrantInteractionChoiceHandledPayload {
  id: string;
  interactRef?: string;
}

export class GrantInteractionChoiceHandledEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateId: string;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = DomainEventTopics.AuthEvents;
  payload: GrantInteractionChoiceHandledPayload;

  constructor(payload: GrantInteractionChoiceHandledPayload) {
    super(payload.id);
    this.aggregateId = this.msgKey = payload.id;
    this.payload = payload;
  }
}

export interface GrantInteractionChoiceFailedPayload {
  grantId: string;
  errorName: string;
  message: string;
}

export class GrantInteractionChoiceFailedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateId: string;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = DomainEventTopics.AuthEvents;
  payload: GrantInteractionChoiceFailedPayload;

  constructor(payload: GrantInteractionChoiceFailedPayload) {
    super(payload.grantId);
    this.aggregateId = this.msgKey = payload.grantId;
    this.payload = payload;
  }
}
