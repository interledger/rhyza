import { TimerEvent, TimerEventTopics } from 'common-types-lib';

// Every event handler instance publishes its tick with this key, so all ticks
// land on one partition and only one instance runs the expiry check.
export const PAYMENT_EXPIRY_CHECK_KEY = 'payment-expiry-check';

export class PaymentExpiryCheckTimerEvent extends TimerEvent {
  msgTopic: string = TimerEventTopics.PaymentTimerEvents;
  payload: undefined = undefined;

  constructor() {
    super(PAYMENT_EXPIRY_CHECK_KEY);
  }
}
