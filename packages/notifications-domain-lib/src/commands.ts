import { CommandMsg, CommandTopics } from 'common-types-lib';

const BOUNDED_CONTEXT_NAME = 'notification';
const NOTIFICATION_AGG_NAME = 'notifications';

export interface CreateNotificationCmdPayload {
  id: string;
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
