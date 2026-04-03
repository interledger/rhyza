'use strict';

export interface IEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export interface IEventRepository {
  store(event: IEvent): Promise<void>;
  fetch(id: string): Promise<IEvent | null>;
  fetchAll(): Promise<IEvent[]>;
}
