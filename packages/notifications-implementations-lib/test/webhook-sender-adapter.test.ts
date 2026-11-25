import test from 'node:test';
import assert from 'node:assert/strict';
import { WebhookSenderAdapter } from '../src/webhook-sender-adapter';
import { notificationToWebhookBody } from '../src/webhook-mapper';
import { Notification, NotificationType } from 'notifications-domain-lib';
import { PaymentCreatedPayload } from 'payments-public-types-lib';
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
          id: randomUUID(),
          paymentIntentId: randomUUID(),
          senderWalletAddress: 'https://wallet.example/alice',
          senderWalletAddressId: '71e202a6-cde9-41f7-b5fd-b1137883dbb7',
          debitAmount: '100',
          receiveAmount: '100',
          sentAmount: '0',
          state: 'CREATED',
          createdAt: new Date(),
          assetCode: 'USD',
          assetScale: 2,
          receiveAssetCode: 'USD',
          receiveAssetScale: 2
        } satisfies PaymentCreatedPayload
      }
    );

    await adapter.send(notification);

    assert.equal(capturedUrl, WEBHOOK_URL);
    assert.deepEqual(capturedOptions, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(notificationToWebhookBody(notification))
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
