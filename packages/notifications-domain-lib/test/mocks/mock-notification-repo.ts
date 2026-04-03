'use strict';

import { INotificationRepository } from '../../src';
import { Notification } from '../../src';

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
}
