import { PendingResponse } from '../types';
import { DomainEvent, ILogger } from 'common-types-lib';

export type EventHandlerFunc = (
  pendingResp: PendingResponse,
  event: DomainEvent
) => Promise<void>;

export class EventHandlerRegistry {
  private readonly _logger: ILogger;
  private readonly _eventHandlers: {
    eventNames: string[];
    func: EventHandlerFunc;
  }[];

  constructor(logger: ILogger) {
    this._logger = logger;
    this._eventHandlers = [];
  }

  getHandler(eventNames: string): EventHandlerFunc | null {
    const found = this._eventHandlers.find((h) =>
      h.eventNames.includes(eventNames)
    );
    if (!found) {
      this._logger.warn(
        `No event handler found for event names: ${eventNames}`
      );
      return null;
    }

    return found.func;
  }

  register(eventNames: string[], func: EventHandlerFunc) {
    const allRegisteredEventsNames = this._eventHandlers.flatMap(
      (item) => item.eventNames
    );
    const exist = eventNames.some((item) =>
      allRegisteredEventsNames.includes(item)
    );

    if (exist) {
      throw new Error(`Event names ${eventNames.join(',')} already registered`);
    }

    this._eventHandlers.push({ eventNames: eventNames, func: func });
  }
}
