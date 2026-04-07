import { INotificationSenderService } from '../../src';

export class MockNotificationSenderService
  implements INotificationSenderService
{
  send(): Promise<void> {
    return Promise.resolve();
  }
}
