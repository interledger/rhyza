'use strict';

import { INotification, NotificationStatus } from './interfaces';

export class Notification implements INotification {
  private _id: string;
  private readonly _data: Record<string, unknown>;
  readonly maxAttempts = 3;
  attempts: number;
  status: NotificationStatus;
  createdAt: Date;
  sentAt?: Date;

  constructor(
    id: string,
    data: Record<string, unknown> = {},
    attempts: number = 0,
    status: NotificationStatus = NotificationStatus.CREATED,
    createdAt: Date = new Date(),
    sentAt?: Date
  ) {
    this._id = id;
    this._data = data;
    this.attempts = attempts;
    this.status = status;
    this.createdAt = createdAt;
    this.sentAt = sentAt;
  }

  get id(): string {
    return this._id;
  }

  get data(): Record<string, unknown> {
    return this._data;
  }

  toObject(): INotification {
    return {
      id: this._id,
      data: this._data,
      attempts: this.attempts,
      status: this.status,
      maxAttempts: this.maxAttempts,
      createdAt: this.createdAt,
      sentAt: this.sentAt
    };
  }

  static fromObject(obj: INotification): Notification {
    return new Notification(
      obj.id,
      obj.data,
      obj.attempts,
      obj.status,
      obj.createdAt,
      obj.sentAt
    );
  }
}
