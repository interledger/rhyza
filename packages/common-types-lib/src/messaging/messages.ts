/* eslint-disable @typescript-eslint/no-explicit-any */

export const MessageDataFormats = {
  JSON: 'JSON',
  PROTOBUF: 'PROTOBUF'
} as const;
export type MessageDataFormats = keyof typeof MessageDataFormats;

export const MessageTypes = {
  STATE_EVENT: 'STATE_EVENT', // for private event-sourcing events
  SNAPSHOT_EVENT: 'SNAPSHOT_EVENT', // for private event-sourcing snapshot events
  DOMAIN_EVENT: 'DOMAIN_EVENT', // public domain events
  COMMAND: 'COMMAND', // for internal/private BC command,
  TIMER: 'TIMER' // for internal BC time dependent routines
} as const;
export type MessageTypes = keyof typeof MessageTypes;

export interface IMessage {
  msgDataFormat: MessageDataFormats;
  msgType: MessageTypes;
  msgId: string;
  msgName: string;
  msgTimestamp: number;
  msgTopic: string;

  msgKey: string | null; // usually the id of the aggregate (used for partitioning)
  msgPartition: number | null;
  msgOffset: number | null;
  msgBatchId: string | null;

  payload: any;

  tracingInfo?: any; // optional tracing information, should be propagated between calls
  requestId?: string;
}

export abstract class BaseMessage implements IMessage {
  msgName: string = this.constructor.name;
  msgId: string;
  msgKey: string | null = null;
  msgPartition: number | null = null;
  msgOffset: number | null = null;
  msgBatchId: string | null = null;
  msgTimestamp: number = Date.now();
  msgDataFormat: MessageDataFormats = MessageDataFormats.JSON;

  payload: any;

  tracingInfo?: any;

  abstract msgTopic: string;
  abstract msgType: MessageTypes;

  requestId?: string;

  protected constructor() {
    this.msgId = crypto.randomUUID();
  }
}

export abstract class StateEvent extends BaseMessage {
  msgType: MessageTypes = MessageTypes.STATE_EVENT;
  declare aggregateId: string;
  declare aggregateVersion: string;

  abstract payload: any;

  protected constructor(aggId: string) {
    super();
    this.aggregateId = aggId;
    this.msgKey = aggId;
  }
}

// snapshot is a form of state event
export abstract class SnapshotEvent extends StateEvent {
  msgType: MessageTypes = MessageTypes.SNAPSHOT_EVENT;

  // special SnapshotEvent members
  declare lastEventIndexPartition: number;
  declare lastEventIndexOffset: number;

  protected constructor(aggId: string, aggVersion: string) {
    super(aggId);
    this.aggregateVersion = aggVersion;
    this.msgKey = aggId;
  }

  abstract payload: any;
}

export abstract class DomainEvent extends BaseMessage {
  msgType: MessageTypes = MessageTypes.DOMAIN_EVENT;
  declare aggregateId: string;

  isErrorEvent: boolean = false;
  abstract payload: any;

  protected constructor(aggId: string) {
    super();
    this.aggregateId = aggId;
  }
}

export abstract class CommandMsg extends BaseMessage {
  msgType: MessageTypes = MessageTypes.COMMAND;
  declare aggregateId: string;
  declare requestId: string;

  abstract payload: any;

  protected constructor(aggId: string) {
    super();
    this.aggregateId = aggId;
  }
}

export abstract class TimerEvent extends BaseMessage {
  msgType: MessageTypes = MessageTypes.TIMER;

  abstract payload: any;

  protected constructor(aggId: string) {
    super();
    this.msgKey = aggId;
  }
}
