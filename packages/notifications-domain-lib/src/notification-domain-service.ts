'use strict';

import { EventAggregate } from './event/aggregate';
import { IEvent } from './event';
import { NotificationAggregate } from './notification/aggregate';
import { INotification } from './notification/interfaces';

export class NotificationDomainService {
  private _eventAggregate: EventAggregate;
  private _notificationAggregate: NotificationAggregate;

  constructor(
    eventAggregate: EventAggregate,
    notificationAggregate: NotificationAggregate
  ) {
    this._eventAggregate = eventAggregate;
    this._notificationAggregate = notificationAggregate;
  }

  async createNotification(eventId: string): Promise<string> {
    const event = await this.getEvent(eventId);
    if (!event) {
      throw new Error(`Event with id ${eventId} not found`);
    }

    const notificationId = crypto.randomUUID();
    await this._notificationAggregate.createNotification(
      notificationId,
      eventId
    );
    return notificationId;
  }

  async getNotification(id: string): Promise<INotification | null> {
    return this._notificationAggregate.getNotification(id);
  }

  async createEvent(
    type: string,
    data: Record<string, unknown>
  ): Promise<string> {
    const eventId = crypto.randomUUID();
    await this._eventAggregate.createEvent(eventId, type, data);
    return eventId;
  }

  async getEvent(id: string): Promise<IEvent | null> {
    return this._eventAggregate.getEvent(id);
  }

  async sendNotification(id: string): Promise<void> {
    await this._notificationAggregate.send(id);
  }
}
