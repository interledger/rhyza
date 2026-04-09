'use strict';

import { INotification, NotificationStatus } from './interfaces';

export class Notification implements INotification {
  private _id: string;
  private readonly _data: Record<string, unknown>;
  readonly maxAttempts = 3;
  private _attempts: number;
  private _status: NotificationStatus;
  private _createdAt: Date;
  private _sentAt: Date | null;

  constructor(
    id: string,
    data: Record<string, unknown> = {},
    attempts: number = 0,
    status: NotificationStatus = NotificationStatus.CREATED,
    createdAt: Date = new Date(),
    sentAt: Date | null = null
  ) {
    this._id = id;
    this._data = data;
    this._attempts = attempts;
    this._status = status;
    this._createdAt = createdAt;
    this._sentAt = sentAt;
  }

  get id(): string {
    return this._id;
  }

  get data(): Record<string, unknown> {
    return this._data;
  }

  get attempts(): number {
    return this._attempts;
  }

  get status(): NotificationStatus {
    return this._status;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get sentAt(): Date | null {
    return this._sentAt;
  }

  toObject(): INotification {
    return {
      id: this._id,
      data: this._data,
      attempts: this._attempts,
      status: this._status,
      maxAttempts: this.maxAttempts,
      createdAt: this._createdAt,
      sentAt: this._sentAt
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

  markAsSent(): void {
    this._status = NotificationStatus.SENT;
    this._sentAt = new Date();
  }

  markAsFailed(): void {
    this._status = NotificationStatus.FAILED;
  }

  incrementAttempts(): void {
    this._attempts++;
  }
}
