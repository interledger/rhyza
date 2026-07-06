'use strict';

export interface INotification {
  id: string;
  type: NotificationType;
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

export enum NotificationType {
  PaymentIntentCreated = 'payment_intent.created',
  PaymentCreated = 'payment.created',
  PaymentCompleted = 'payment.completed',
  PaymentFailed = 'payment.failed'
}

export interface INotificationRepository {
  store(notification: INotification): Promise<void>;
}

export interface INotificationSenderService {
  send(notification: INotification): Promise<void>;
}
