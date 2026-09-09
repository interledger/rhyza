import { CommandMsg, CommandTopics } from 'common-types-lib';
import { NotificationType } from './interfaces';

const BOUNDED_CONTEXT_NAME = 'notification';
const NOTIFICATION_AGG_NAME = 'notifications';

export interface CreateNotificationCmdPayload {
  id: string;
  type: NotificationType;
  data: Record<string, unknown>;
}

export class CreateNotificationCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateId: string;
  aggregateName: string = NOTIFICATION_AGG_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.NotificationCommands;
  payload: CreateNotificationCmdPayload;
  constructor(payload: CreateNotificationCmdPayload, requestId?: string) {
    super(payload.id);
    this.aggregateId = this.msgKey = payload.id;
    this.requestId = requestId ?? '';
    this.payload = payload;
  }
}

export interface RetryNotificationTickCmdPayload {
  id: string;
}
export class RetryNotificationTickCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateId: string;
  aggregateName: string = NOTIFICATION_AGG_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.NotificationCommands;
  payload: RetryNotificationTickCmdPayload;

  constructor(payload: RetryNotificationTickCmdPayload, requestId?: string) {
    super(payload.id);
    this.aggregateId = this.msgKey = payload.id;
    this.requestId = requestId ?? '';
    this.payload = payload;
  }
}
