'use strict';

import { INotificationRepository, Notification } from '../../src';

export class MockNotificationRepo implements INotificationRepository {
  private notifications: Map<string, Notification> = new Map();

  async store(notification: Notification): Promise<void> {
    this.notifications.set(notification.id, notification);
    return Promise.resolve();
  }
  async fetch(id: string): Promise<Notification | null> {
    const notification = this.notifications.get(id);
    return Promise.resolve(notification ?? null);
  }
  async fetchAll(): Promise<Notification[]> {
    return Promise.resolve(Array.from(this.notifications.values()));
  }
  clear(): void {
    this.notifications.clear();
  }
}
