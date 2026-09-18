import { NotificationType, INotification } from 'notifications-domain-lib';
import {
  FailedMessagePayload,
  PaymentIntentCreatedPayload,
  PaymentIntentCompletedPayload,
  PaymentCreatedPayload,
  PaymentCompletedPayload,
  SentPaymentState
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
      const intentData = data as PaymentIntentPayload;
      return {
        id: intentData.id,
        walletAddressId: intentData.receiverWalletAddressId,
        createdAt: intentData.createdAt,
        expiresAt: intentData.expiresAt,
        receiveAmount: {
          value: intentData.receivedAmount,
          assetCode: intentData.assetCode,
          assetScale: intentData.assetScale
        }
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
        state: mapState(paymentData.state)
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

function mapState(state: SentPaymentState): SentPaymentState {
  switch (state) {
    case 'CREATED':
    case 'PROCESSING':
    case 'SENDING':
      return SentPaymentState.CREATED;
    case 'COMPLETED':
    case 'CONFIRMED':
      return SentPaymentState.COMPLETED;
    case 'FAILED':
    case 'CANCELLED':
    case 'REJECTED':
      return SentPaymentState.FAILED;
  }
}
