// message published by the peer aggregate when a fx rate is expired
import {
  DomainEvent,
  DomainEventTopics,
  MessageDataFormats
} from 'common-types-lib';

export abstract class FxRateDomainEvent extends DomainEvent {
  msgDataFormat: MessageDataFormats = MessageDataFormats.JSON;
  msgTopic: string = DomainEventTopics.FxRateEvents;
  // set to true by exception in then implementing class
  isErrorEvent = false;

  protected constructor(aggId: string) {
    super(aggId);
    this.requestId = crypto.randomUUID();
  }

  static isFxRateCacheExpiredEvent(
    evt: DomainEvent
  ): evt is FxRateCacheExpiredEvent {
    return evt.msgName === FxRateCacheExpiredEvent.name;
  }
}

export class FxRateCacheExpiredEvent extends FxRateDomainEvent {
  payload: FxRateCacheExpiredEventPayload;

  constructor(payload: FxRateCacheExpiredEventPayload) {
    super(payload.id);
    this.msgKey = payload.id;
    this.payload = payload;
  }
}
export type FxRateCacheExpiredEventPayload = {
  id: string;
};
