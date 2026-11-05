'use strict';

import { InboundPrepareSnapshot } from '../packet';

export function inboundPrepareFrom(prepare: {
  destinationIlpAddress: string;
  amount: string;
  expiresAt: string;
  executionCondition: string;
  data?: string;
}): InboundPrepareSnapshot {
  return {
    destinationIlpAddress: prepare.destinationIlpAddress,
    amount: prepare.amount,
    expiresAt: prepare.expiresAt,
    executionCondition: prepare.executionCondition,
    data: prepare.data ?? ''
  };
}

export function toIlpPrepare(snapshot: InboundPrepareSnapshot): {
  destination: string;
  amount: string;
  expiresAt: Date;
  executionCondition: Buffer;
  data: Buffer;
} {
  return {
    destination: snapshot.destinationIlpAddress,
    amount: snapshot.amount,
    expiresAt: new Date(snapshot.expiresAt),
    executionCondition: Buffer.from(snapshot.executionCondition, 'base64'),
    data: Buffer.from(snapshot.data, 'base64')
  };
}
