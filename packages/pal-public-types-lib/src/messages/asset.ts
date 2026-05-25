import {
  DomainEvent,
  DomainEventTopics,
  MessageDataFormats
} from 'common-types-lib';

export abstract class AssetDomainEvent extends DomainEvent {
  msgDataFormat: MessageDataFormats = MessageDataFormats.JSON;
  msgTopic: string = DomainEventTopics.AssetEvents;
  // set to true by exception in then implementing class
  isErrorEvent = false;

  protected constructor(aggId: string) {
    super(aggId);
    this.requestId = crypto.randomUUID();
  }

  static isAssetCreatedEvent(evt: DomainEvent): evt is AssetCreatedEvent {
    return evt.msgName === AssetCreatedEvent.name;
  }

  static isAssetCreationFailedEvent(
    evt: DomainEvent
  ): evt is AssetCreationFailedEvent {
    return evt.msgName === AssetCreationFailedEvent.name;
  }

  static isAssetActivatedEvent(evt: DomainEvent): evt is AssetActivatedEvent {
    return evt.msgName === AssetActivatedEvent.name;
  }
}

/*
 * Domain Events (for now sort of integration events as well)
 * */

export type AssetCreatedEventPayload = {
  assetCode: string;
};
export class AssetCreatedEvent extends AssetDomainEvent {
  payload: AssetCreatedEventPayload;

  constructor(payload: AssetCreatedEventPayload) {
    super(payload.assetCode);
    this.msgKey = payload.assetCode;
    this.payload = payload;
  }
}

export type AssetCreationFailedEventPayload = {
  assetCode: string;
  reason: 'DUPLICATE_ASSET_CODE' | 'UNKNOWN';
};
export class AssetCreationFailedEvent extends AssetDomainEvent {
  payload: AssetCreationFailedEventPayload;
  isErrorEvent = true;

  constructor(payload: AssetCreationFailedEventPayload) {
    super(payload.assetCode);
    this.msgKey = payload.assetCode;
    this.payload = payload;
  }
}

/**
 * When the asset is activated, ie, was created, has ledger accounts, and is ready to be used
 */
export class AssetActivatedEvent extends AssetDomainEvent {
  payload: AssetActivatedEventPayload;

  constructor(payload: AssetActivatedEventPayload) {
    super(payload.assetCode);
    this.msgKey = payload.assetCode;
    this.payload = payload;
  }
}
export type AssetActivatedEventPayload = {
  assetCode: string;
};
