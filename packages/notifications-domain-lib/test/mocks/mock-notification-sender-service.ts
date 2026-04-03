import { INotificationSenderService, NotificationStatus } from '../../src';

export class MockNotificationSenderService
  implements INotificationSenderService
{
  send(): Promise<NotificationStatus> {
    return Promise.resolve(NotificationStatus.SUCCESS);
  }
}
