export const PaymentIntentState = {
  CREATED: 'CREATED',
  COMPLETED: 'COMPLETED',
  EXPIRED: 'EXPIRED'
} as const;
export type PaymentIntentState = keyof typeof PaymentIntentState;

export const SentPaymentState = {
  CREATED: 'CREATED',
  PROCESSING: 'PROCESSING',
  SENDING: 'SENDING',
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED'
} as const;
export type SentPaymentState = keyof typeof SentPaymentState;

export const InboundPaymentState = {
  VALIDATED: 'VALIDATED',
  ACCEPTED: 'ACCEPTED',
  FULFILLABLE: 'FULFILLABLE',
  FINALIZED: 'FINALIZED',
  FAILED: 'FAILED'
} as const;
export type InboundPaymentState = keyof typeof InboundPaymentState;
