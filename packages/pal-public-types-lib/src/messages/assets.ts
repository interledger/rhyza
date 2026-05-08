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
  }

  static isAssetCreatedEvent(evt: DomainEvent): evt is AssetCreatedEvent {
    return evt.msgName === AssetCreatedEvent.name;
  }
}

/*
 * Domain Events (for now sort of integration events as well)
 * */

export type AssetCreatedEventPayload = {
  code: string;
  scale: number;
  liquidityLowThreshold: bigint | null;
  liquidityHighThreshold: bigint | null;
};
export class AssetCreatedEvent extends AssetDomainEvent {
  payload: AssetCreatedEventPayload;

  constructor(payload: AssetCreatedEventPayload) {
    super(payload.code);
    this.payload = payload;
  }
}
