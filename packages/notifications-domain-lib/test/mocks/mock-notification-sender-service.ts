import { INotificationSenderService } from '../../src';

export class MockNotificationSenderService
  implements INotificationSenderService
{
  async send(): Promise<void> {
    return Promise.resolve();
  }
}
