'use strict';

export interface INotification {
  id: string;
  eventId: string;
  attempts: number;
  status: NotificationStatus;
  maxAttempts: number;
}

export enum NotificationStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED'
}

export interface INotificationRepository {
  store(notification: INotification): Promise<void>;
  fetch(id: string): Promise<INotification | null>;
}

export interface INotificationSenderService {
  send(notification: INotification): Promise<NotificationStatus>;
}
