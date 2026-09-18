import {
  INotification,
  INotificationSenderService,
  NotificationSendError
} from 'notifications-domain-lib';
import { notificationToWebhookBody } from './webhook-mapper';

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3000/webhooks';

export class WebhookSenderAdapter implements INotificationSenderService {
  async send(notification: INotification): Promise<void> {
    const requestHeaders = {
      'Content-Type': 'application/json'
    };
    const body = notificationToWebhookBody(notification);

    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(body)
      });
    } catch (err) {
      // Connection refused / DNS / timeout etc. the endpoint may recover
      throw new NotificationSendError(
        `Failed to send notification with id ${notification.id}: ${(err as Error).message}`,
        { retryable: true }
      );
    }

    if (!response.ok) {
      // 5xx and 429 are transient and worth retrying. Other 4xx are permanent
      // client errors (bad request, auth, not found) — retrying won't help.
      const retryable = response.status >= 500 || response.status === 429;
      throw new NotificationSendError(
        `Failed to send notification with id ${notification.id}: ${response.status} ${response.statusText}`,
        { status: response.status, retryable }
      );
    }
  }
}
