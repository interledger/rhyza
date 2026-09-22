'use strict';

import {
  INotification,
  NotificationStatus,
  NotificationType
} from './interfaces';

export interface NotificationOptions {
  data?: Record<string, unknown>;
  attempts?: number;
  status?: NotificationStatus;
  createdAt?: Date;
  sentAt?: Date | null;
  maxAttempts?: number;
}
export class Notification implements INotification {
  private _id: string;
  private readonly _type: NotificationType;
  private readonly _data: Record<string, unknown>;
  readonly maxAttempts;
  private _attempts: number;
  private _status: NotificationStatus;
  private _createdAt: Date;
  private _sentAt: Date | null;

  constructor(
    id: string,
    type: NotificationType,
    options: NotificationOptions = {}
  ) {
    this._id = id;
    this._type = type;

    const {
      data = {},
      attempts = 0,
      status = NotificationStatus.SENDING,
      createdAt = new Date(),
      sentAt = null,
      maxAttempts = 3
    } = options;

    this._data = data;
    this._attempts = attempts;
    this._status = status;
    this._createdAt = createdAt;
    this._sentAt = sentAt;
    this.maxAttempts = maxAttempts;
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

  get type(): NotificationType {
    return this._type;
  }

  toObject(): INotification {
    return {
      id: this._id,
      type: this._type,
      data: this._data,
      attempts: this._attempts,
      status: this._status,
      maxAttempts: this.maxAttempts,
      createdAt: this._createdAt,
      sentAt: this._sentAt
    };
  }

  static fromObject(obj: INotification): Notification {
    return new Notification(obj.id, obj.type, {
      data: obj.data,
      attempts: obj.attempts,
      status: obj.status,
      createdAt: obj.createdAt,
      sentAt: obj.sentAt,
      maxAttempts: obj.maxAttempts
    });
  }

  markAsSending(): void {
    this._status = NotificationStatus.SENDING;
  }

  markAsSent(): void {
    this._status = NotificationStatus.SENT;
    this._sentAt = new Date();
  }

  incrementAttempts(): void {
    this._attempts++;
  }

  markAsFailed(): void {
    this._status =
      this._attempts < this.maxAttempts
        ? NotificationStatus.PENDING_RETRY
        : NotificationStatus.FAILED;
  }
}
