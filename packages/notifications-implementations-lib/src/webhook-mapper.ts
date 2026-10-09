import { NotificationType, INotification } from 'notifications-domain-lib';
import {
  PaymentIntentCreatedPayload,
  PaymentIntentCompletedPayload,
  PaymentCreatedPayload,
  PaymentCompletedPayload,
  PaymentCompleteFailedPayload
} from 'payments-public-types-lib';

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
        receivedAmount: {
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
        state: paymentIntentData.state,
        ...(paymentIntentData.metadata && {
          metadata: paymentIntentData.metadata
        })
      };
    }

    case NotificationType.PaymentCreated:
    case NotificationType.PaymentCompleted: {
      const paymentData = data as PaymentPayload;
      const basePayment = {
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
        state: paymentData.state,
        ...(paymentData.metadata && {
          metadata: paymentData.metadata
        })
      };
      if (type === NotificationType.PaymentCreated) {
        return {
          ...basePayment,
          paymentIntentRemoteUrl: (data as PaymentCreatedPayload)
            .paymentIntentRemoteUrl
        };
      }
      return basePayment;
    }

    case NotificationType.PaymentFailed: {
      const failedData = data as PaymentCompleteFailedPayload;
      return {
        id: failedData.id,
        paymentIntentId: failedData.paymentIntentId,
        errorName: failedData.errorName,
        message: failedData.message,
        sentAmount: {
          value: failedData.sentAmount,
          assetCode: failedData.assetCode,
          assetScale: failedData.assetScale
        },
        walletAddressId: failedData.walletAddressId
      };
    }

    case NotificationType.GrantRevoked: {
      return data;
    }

    default:
      return {};
  }
}
