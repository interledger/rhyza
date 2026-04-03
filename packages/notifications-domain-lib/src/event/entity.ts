'use strict';

import { IEvent } from './interfaces';

export class Event implements IEvent {
  private readonly _id: string;
  private readonly _type: string;
  private readonly _data: Record<string, unknown>;
  // private _notifications: INotification[];

  constructor(id: string, type: string, data: Record<string, unknown>) {
    this._id = id;
    this._type = type;
    this._data = data;
  }

  static fromObject(json: IEvent): Event {
    return new Event(json.id, json.type, json.data);
  }

  toObject(): IEvent {
    return {
      id: this._id,
      type: this._type,
      data: this._data
    };
  }

  get id(): string {
    return this._id;
  }

  get type(): string {
    return this._type;
  }

  get data(): Record<string, unknown> {
    return this._data;
  }
}
