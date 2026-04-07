'use strict';

export interface INotification {
  id: string;
  attempts: number;
  status: NotificationStatus;
  maxAttempts: number;
  createdAt: Date;
  sentAt?: Date;
}

export enum NotificationStatus {
  CREATED = 'CREATED',
  SENT = 'SENT',
  FAILED = 'FAILED'
}

export interface INotificationRepository {
  store(notification: INotification): Promise<void>;
  fetch(id: string): Promise<INotification | null>;
}

export interface INotificationSenderService {
  send(notification: INotification): Promise<void>;
}
