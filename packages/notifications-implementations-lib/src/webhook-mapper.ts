import { NotificationType, INotification } from 'notifications-domain-lib';
import {
  FailedMessagePayload,
  PaymentIntentCreatedPayload,
  PaymentIntentCompletedPayload,
  PaymentCreatedPayload,
  PaymentCompletedPayload
} from 'payments-public-types-lib';

type FailedPayload = {
  id?: string;
  paymentIntentId?: string;
} & FailedMessagePayload;

type PaymentIntentPayload =
  | PaymentIntentCreatedPayload
  | PaymentIntentCompletedPayload;
type PaymentPayload = PaymentCreatedPayload | PaymentCompletedPayload;

export function notificationToWebhookBody(notification: INotification) {
  return {
    id: notification.id,
    type: notification.type,
    data: getWebhookData(notification.type, notification.data)
  };
}

function getWebhookData(type: NotificationType, data: Record<string, unknown>) {
  switch (type) {
    case NotificationType.PaymentIntentCreated:
    case NotificationType.PaymentIntentCompleted: {
      const paymentIntentData = data as PaymentIntentPayload;
      return {
        id: paymentIntentData.id,
        walletAddressId: paymentIntentData.receiverWalletAddressId,
        createdAt: paymentIntentData.createdAt,
        expiresAt: paymentIntentData.expiresAt,
        receiveAmount: {
          value: paymentIntentData.receivedAmount,
          assetCode: paymentIntentData.assetCode,
          assetScale: paymentIntentData.assetScale
        },
        ...(paymentIntentData.incomingAmount && {
          incomingAmount: {
            value: paymentIntentData.incomingAmount,
            assetCode: paymentIntentData.assetCode,
            assetScale: paymentIntentData.assetScale
          }
        }),
        state: paymentIntentData.state
      };
    }

    case NotificationType.PaymentCreated:
    case NotificationType.PaymentCompleted: {
      const paymentData = data as PaymentPayload;
      return {
        id: paymentData.id,
        paymentIntentId: paymentData.paymentIntentId,
        walletAddressId: paymentData.senderWalletAddressId,
        createdAt: paymentData.createdAt,
        debitAmount: {
          value: paymentData.debitAmount,
          assetCode: paymentData.assetCode,
          assetScale: paymentData.assetScale
        },
        sentAmount: {
          value: paymentData.sentAmount,
          assetCode: paymentData.assetCode,
          assetScale: paymentData.assetScale
        },
        receiveAmount: {
          value: paymentData.receiveAmount,
          assetCode: paymentData.receiveAssetCode,
          assetScale: paymentData.receiveAssetScale
        },
        state: paymentData.state
      };
    }

    case NotificationType.PaymentFailed: {
      const failedData = data as FailedPayload;
      return {
        ...(failedData.id && { id: failedData.id }),
        ...(failedData.paymentIntentId && {
          paymentIntentId: failedData.paymentIntentId
        }),
        errorName: failedData.errorName,
        message: failedData.message
      };
    }

    default:
      return {};
  }
}
