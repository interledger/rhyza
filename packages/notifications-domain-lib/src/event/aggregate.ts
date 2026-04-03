'use strict';

import { IEventRepository } from './interfaces';
import { Event } from './entity';

export class EventAggregate {
  private _repo: IEventRepository;

  constructor(repo: IEventRepository) {
    this._repo = repo;
  }

  async createEvent(
    id: string,
    type: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const event = new Event(id, type, data);
    await this._repo.store(event.toObject());
  }

  async getEvent(id: string) {
    const found = await this._repo.fetch(id);
    return found ? Event.fromObject(found) : null;
  }

  async getEvents() {
    return await this._repo.fetchAll();
  }
}
