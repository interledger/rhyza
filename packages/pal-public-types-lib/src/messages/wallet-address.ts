import {
  DomainEvent,
  DomainEventTopics,
  MessageDataFormats
} from 'common-types-lib';

export abstract class WalletAddressDomainEvent extends DomainEvent {
  msgDataFormat: MessageDataFormats = MessageDataFormats.JSON;
  msgTopic: string = DomainEventTopics.WalletAddressEvents;
  // set to true by exception in then implementing class
  isErrorEvent = false;

  protected constructor(aggId: string) {
    super(aggId);
    this.requestId = crypto.randomUUID();
  }

  static isWalletAddressCreatedEvent(
    evt: DomainEvent
  ): evt is WalletAddressCreatedEvent {
    return evt.msgName === WalletAddressCreatedEvent.name;
  }
}

/*
 * Domain Events (for now sort of integration events as well)
 * */

export type WalletAddressCreatedEventPayload = {
  id: string;
  domain: string | null;
  pathName: string;
  publicName: string;
  assetCode: string;
  assetScale: number;
  isActive: boolean;
};
export class WalletAddressCreatedEvent extends WalletAddressDomainEvent {
  payload: WalletAddressCreatedEventPayload;

  constructor(payload: WalletAddressCreatedEventPayload) {
    super(payload.id);
    this.payload = payload;
  }
}

export type WalletAddressAliasCreatedEventPayload = {
  walletId: string;
  domain: string | null;
  pathName: string;
};
export class WalletAddressAliasCreatedEvent extends WalletAddressDomainEvent {
  payload: WalletAddressAliasCreatedEventPayload;

  constructor(payload: WalletAddressAliasCreatedEventPayload) {
    super(payload.walletId);
    this.payload = payload;
  }
}
