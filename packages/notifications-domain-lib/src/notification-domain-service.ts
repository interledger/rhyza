'use strict';

import { NotificationAggregate } from './notification/aggregate';
import { INotification } from './notification/interfaces';

export class NotificationDomainService {
  private _notificationAggregate: NotificationAggregate;

  constructor(notificationAggregate: NotificationAggregate) {
    this._notificationAggregate = notificationAggregate;
  }

  async createAndSendNotification(): Promise<string> {
    const notificationId = crypto.randomUUID();
    await this._notificationAggregate.createAndSendNotification(notificationId);
    return notificationId;
  }

  async getNotification(id: string): Promise<INotification | null> {
    return this._notificationAggregate.getNotification(id);
  }
}
