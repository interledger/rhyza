'use strict';

import { INotification, NotificationStatus } from './interfaces';

// rename notif.
export class Notification implements INotification {
  private _id: string;
  private _eventId: string;
  readonly maxAttempts = 3;
  attempts: number;
  status: NotificationStatus;

  constructor(
    id: string,
    eventId: string,
    attempts: number = 0,
    status: NotificationStatus = NotificationStatus.PENDING
  ) {
    this._id = id;
    this._eventId = eventId;
    this.attempts = attempts;
    this.status = status;
  }

  get id(): string {
    return this._id;
  }

  get eventId(): string {
    return this._eventId;
  }

  toObject(): INotification {
    return {
      id: this._id,
      eventId: this._eventId,
      attempts: this.attempts,
      status: this.status,
      maxAttempts: this.maxAttempts
    };
  }

  static fromObject(obj: INotification): Notification {
    return new Notification(obj.id, obj.eventId, obj.attempts, obj.status);
  }
}
