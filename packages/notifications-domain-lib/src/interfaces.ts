'use strict';

export interface INotification {
  id: string;
  data: Record<string, unknown>;
  attempts: number;
  status: NotificationStatus;
  maxAttempts: number;
  createdAt: Date;
  sentAt: Date | null;
}

export enum NotificationStatus {
  CREATED = 'CREATED',
  SENT = 'SENT',
  FAILED = 'FAILED'
}

export interface INotificationRepository {
  store(notification: INotification): Promise<void>;
}

export interface INotificationSenderService {
  send(notification: INotification): Promise<void>;
}
