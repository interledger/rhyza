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
  SENDING = 'SENDING',
  PENDING_RETRY = 'PENDING_RETRY',
  SENT = 'SENT',
  FAILED = 'FAILED'
}

export enum NotificationType {
  PaymentIntentCreated = 'payment_intent.created',
  PaymentIntentCompleted = 'payment_intent.completed',
  PaymentCreated = 'payment.created',
  PaymentCompleted = 'payment.completed',
  PaymentFailed = 'payment.failed'
}

export interface INotificationRepository {
  get(id: string): Promise<INotification | null>;
  store(notification: INotification): Promise<void>;
  getPendingRetryNotificationIds(limit: number): Promise<string[]>;
}

export interface INotificationSenderService {
  send(notification: INotification): Promise<void>;
}

/**
 * Error thrown by an INotificationSenderService when a send fails. `retryable`
 * lets the aggregate decide whether another attempt could succeed.
 */
export class NotificationSendError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(
    message: string,
    opts: { status?: number | null; retryable: boolean }
  ) {
    super(message);
    this.name = 'NotificationSendError';
    this.status = opts.status ?? null;
    this.retryable = opts.retryable;
  }
}
