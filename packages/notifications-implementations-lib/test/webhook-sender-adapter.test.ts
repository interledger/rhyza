import test from 'node:test';
import assert from 'node:assert/strict';
import { WebhookSenderAdapter } from '../src/webhook-sender-adapter';
import { Notification, NotificationType } from 'notifications-domain-lib';
import { randomUUID } from 'node:crypto';

test('sends notification to webhook', async () => {
  const originalFetch = globalThis.fetch;
  const WEBHOOK_URL = 'http://localhost:3000/webhooks';

  let capturedUrl: string | undefined;
  let capturedOptions: RequestInit | undefined;

  globalThis.fetch = async (
    url: string | URL | Request,
    options?: RequestInit
  ) => {
    capturedUrl = url.toString();
    capturedOptions = options;

    return {
      ok: true
    } as Response;
  };

  try {
    const adapter = new WebhookSenderAdapter();
    const notification = new Notification(
      randomUUID(),
      NotificationType.PaymentCreated,
      {
        data: {
          createdAt: new Date(),
          expiresAt: new Date(),
          incomingAmount: '100',
          receivedAmount: '0',
          state: 'CREATED',
          receiverWalletAddressId: '71e202a6-cde9-41f7-b5fd-b1137883dbb7',
          assetCode: 'USD',
          assetScale: 2
        }
      }
    );

    await adapter.send(notification);

    assert.equal(capturedUrl, WEBHOOK_URL);
    assert.deepEqual(capturedOptions, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        id: notification.id,
        type: notification.type,
        data: notification.data
      })
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
