import { INotificationSenderService } from 'notifications-domain-lib';

export class WebhookSenderAdapter implements INotificationSenderService {
  // TODO: Implement notification sending
  send(): Promise<void> {
    return Promise.resolve();
  }
}
