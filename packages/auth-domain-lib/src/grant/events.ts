import { DomainEventTopics, DomainEvent } from 'common-types-lib';
import { GrantFinalization } from './interfaces';

const BOUNDED_CONTEXT_NAME = 'auth';
const AGGREGATE_NAME = 'grant';

export interface GrantCreatedPayload {
  id: string;
}

export class GrantCreatedEvent extends DomainEvent {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateId: string;
  aggregateName: string = AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = DomainEventTopics.AuthEvents;
  payload: GrantCreatedPayload;

  constructor(payload: GrantCreatedPayload) {
    super(payload.id);
    this.aggregateId = this.msgKey = payload.id;
    this.payload = payload;
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

  constructor(payload: GrantCreateFailedPayload) {
    super(payload.grantId);
    this.aggregateId = this.msgKey = payload.grantId;
    this.payload = payload;
  }
}

export interface GrantContinuedPayload {
  id: string;
  result: GrantFinalization;
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

export interface GrantInteractionChoiceHandledPayload {
  id: string;
  interactId: string;
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
  errName: string;
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
