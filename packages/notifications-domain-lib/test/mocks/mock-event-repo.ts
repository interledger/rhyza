'use strict';

import { IEvent, IEventRepository } from '../../src';
import { Event } from '../../src';

export class MockEventRepo implements IEventRepository {
  private events: Map<string, Event> = new Map();

  async store(event: Event): Promise<void> {
    this.events.set(event.id, event);
    return Promise.resolve();
  }
  async fetch(id: string): Promise<Event | null> {
    const event = this.events.get(id);
    return Promise.resolve(event ?? null);
  }

  async fetchAll(): Promise<IEvent[]> {
    return Promise.resolve(Array.from(this.events.values()));
  }
}
