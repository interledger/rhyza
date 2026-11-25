import { NotificationType, INotification } from 'notifications-domain-lib';
import {
  PaymentIntentCreatedPayload,
  PaymentIntentCompletedPayload,
  PaymentCreatedPayload,
  PaymentCompletedPayload,
  PaymentFailedPayload
} from 'payments-public-types-lib';

type PaymentIntentPayload =
  | PaymentIntentCreatedPayload
  | PaymentIntentCompletedPayload;
type PaymentPayload =
  | PaymentCreatedPayload
  | PaymentCompletedPayload
  | PaymentFailedPayload;

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
    case NotificationType.PaymentCompleted:
    case NotificationType.PaymentFailed: {
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
        ...('metadata' in paymentData &&
          paymentData.metadata && {
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
      if ('reason' in paymentData && paymentData.reason) {
        return { ...basePayment, failReason: paymentData.reason };
      }
      return basePayment;
    }

    case NotificationType.GrantRevoked: {
      return data;
    }

    default:
      return {};
  }
}
