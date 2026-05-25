import {
  DomainEvent,
  DomainEventTopics,
  MessageDataFormats
} from 'common-types-lib';

export abstract class PeerDomainEvent extends DomainEvent {
  msgDataFormat: MessageDataFormats = MessageDataFormats.JSON;
  msgTopic: string = DomainEventTopics.PeerEvents;
  // set to true by exception in then implementing class
  isErrorEvent = false;

  protected constructor(aggId: string) {
    super(aggId);
    this.requestId = crypto.randomUUID();
  }

  static isPeerCreatedEvent(evt: DomainEvent): evt is PeerCreatedEvent {
    return evt.msgName === PeerCreatedEvent.name;
  }
  static isPeerCreationFailedEvent(
    evt: DomainEvent
  ): evt is PeerCreationFailedEvent {
    return evt.msgName === PeerCreationFailedEvent.name;
  }
  static isPeerActivatedEvent(evt: DomainEvent): evt is PeerActivatedEvent {
    return evt.msgName === PeerActivatedEvent.name;
  }
}

/*
 * Domain Events (for now sort of integration events as well)
 * */

export type PeerCreatedEventPayload = {
  peerId: string;
  assetCode: string;
};
export class PeerCreatedEvent extends PeerDomainEvent {
  payload: PeerCreatedEventPayload;

  constructor(payload: PeerCreatedEventPayload) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
  }
}

export type PeerCreationFailedEventPayload = {
  peerId: string;
  reason: 'DUPLICATE_ASSET_CODE' | 'UNKNOWN';
};
export class PeerCreationFailedEvent extends PeerDomainEvent {
  payload: PeerCreationFailedEventPayload;
  isErrorEvent = true;

  constructor(payload: PeerCreationFailedEventPayload) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
  }
}

/**
 * When the peer is activated, ie, was created, has ledger accounts, and is ready to be used
 */
export class PeerActivatedEvent extends PeerDomainEvent {
  payload: PeerActivatedEventPayload;

  constructor(payload: PeerActivatedEventPayload) {
    super(payload.peerId);
    this.msgKey = payload.peerId;
    this.payload = payload;
  }
}
export type PeerActivatedEventPayload = {
  peerId: string;
};
