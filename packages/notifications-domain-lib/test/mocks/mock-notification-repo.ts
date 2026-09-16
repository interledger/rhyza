'use strict';

import {
  INotification,
  INotificationRepository,
  NotificationStatus
} from '../../src';

export class MockNotificationRepo implements INotificationRepository {
  private notifications: Map<string, INotification> = new Map();

  async store(notification: INotification): Promise<void> {
    this.notifications.set(notification.id, notification);
    return Promise.resolve();
  }

  async get(id: string): Promise<INotification | null> {
    return this.fetch(id);
  }

  async fetch(id: string): Promise<INotification | null> {
    const notification = this.notifications.get(id);
    return Promise.resolve(notification ?? null);
  }
  async fetchAll(): Promise<INotification[]> {
    return Promise.resolve(Array.from(this.notifications.values()));
  }

  async getPendingRetryNotificationIds(limit: number): Promise<string[]> {
    return Promise.resolve(
      Array.from(this.notifications.values())
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .filter((n) => n.status === NotificationStatus.PENDING_RETRY)
        .map((n) => n.id)
        .slice(0, limit)
    );
  }
  clear(): void {
    this.notifications.clear();
  }
}
