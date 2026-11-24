import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Notification, NotificationType } from 'notifications-domain-lib';
import { PaymentFailedPayload } from 'payments-public-types-lib';
import { notificationToWebhookBody } from '../src/webhook-mapper';

test('maps a failed payment to a payment.failed webhook body', () => {
  const createdAt = new Date();
  const payload: PaymentFailedPayload = {
    id: randomUUID(),
    paymentIntentId: randomUUID(),
    senderWalletAddress: 'https://wallet.example/alice',
    senderWalletAddressId: randomUUID(),
    debitAmount: '1000',
    receiveAmount: '900',
    sentAmount: '0',
    state: 'FAILED',
    createdAt,
    assetCode: 'USD',
    assetScale: 2,
    receiveAssetCode: 'EUR',
    receiveAssetScale: 2,
    reason: 'Insufficient funds'
  };
  const notification = new Notification(
    randomUUID(),
    NotificationType.PaymentFailed,
    { data: payload }
  );

  const body = notificationToWebhookBody(notification);

  assert.deepEqual(body, {
    id: notification.id,
    type: NotificationType.PaymentFailed,
    data: {
      id: payload.id,
      paymentIntentId: payload.paymentIntentId,
      walletAddressId: payload.senderWalletAddressId,
      createdAt,
      debitAmount: { value: '1000', assetCode: 'USD', assetScale: 2 },
      sentAmount: { value: '0', assetCode: 'USD', assetScale: 2 },
      receiveAmount: { value: '900', assetCode: 'EUR', assetScale: 2 },
      state: 'FAILED',
      failReason: 'Insufficient funds'
    }
  });
});

test('omits failReason when the payment failed without a reason', () => {
  const notification = new Notification(
    randomUUID(),
    NotificationType.PaymentFailed,
    {
      data: {
        id: randomUUID(),
        paymentIntentId: randomUUID(),
        senderWalletAddress: 'https://wallet.example/alice',
        senderWalletAddressId: randomUUID(),
        debitAmount: '1000',
        receiveAmount: null,
        sentAmount: '0',
        state: 'FAILED',
        createdAt: new Date(),
        assetCode: 'USD',
        assetScale: 2,
        receiveAssetCode: 'USD',
        receiveAssetScale: 2
      } satisfies PaymentFailedPayload
    }
  );

  const body = notificationToWebhookBody(notification);

  assert.equal('failReason' in body.data, false);
});
