import { IMessage } from './messages';
import { IRawMessage } from './raw/messages';
import { ITelemetryService } from '../telemetry';

export interface IMessageFetcher {
  fetchLast(
    msgKey: string,
    topic: string,
    partitionAndOffset?: { partition: number; offset: number }
  ): Promise<IMessage | null>;
  fetchAll(
    msgKey: string,
    topic: string,
    partitionAndOffset?: { partition: number; offset: number }
  ): Promise<IMessage[]>;
}

//
// export interface IEventSourcingRepository{
//     // for any events other than snapshot events
//     publishEvents(events:IMessage[]):Promise<void>
//
//     // specific for snapshot events
//     publishSnapshotEvent(events:SnapshotEvent[]):Promise<void>;
//
//     fetchLastSnapshot(aggId:string):Promise<SnapshotEvent | null>;
//     fetchStateEvents(aggId:string, partitionAndOffset?: { partition: number, offset: number }):Promise<StateEvent[]>;
// }

export interface IMessageProducerAcks {
  topic: string;
  partition: number;
  lastMsgOffset: number;
}

export declare interface IMessageProducer {
  destroy(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendWithoutAcks(message: IMessage | IMessage[]): Promise<void>;
  send(message: IMessage | IMessage[]): Promise<IMessageProducerAcks[]>;
}

export interface IMessageConsumer {
  setCallbackFn(handlerCallback: (message: IMessage) => Promise<void>): void;
  setBatchCallbackFn(
    batchHandlerCallback: (messages: IMessage[]) => Promise<void>
  ): void;
  setFilteringFn(filterFn: (message: IMessage) => boolean): void;

  setOnRebalanceFn(onRebalanceFn: () => Promise<void>): void;

  setTopics(topics: string[]): void;

  setBatchSize(size: number): void;

  destroy(force: boolean): Promise<void>;

  connect(): Promise<void>;
  disconnect(force: boolean): Promise<void>;
  start(): Promise<void>;
  startAndWaitForRebalance(): Promise<void>;
  stop(): Promise<void>;
}

export interface IRawMessageSerializerFactory {
  setTelemetry(telemetryService: ITelemetryService): void;
  serialize(msg: IMessage): IRawMessage;
  deserialize(rawMsg: IRawMessage): IMessage;
}
