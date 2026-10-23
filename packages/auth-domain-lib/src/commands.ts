import { CommandMsg, CommandTopics } from 'common-types-lib';
import { IAccessItem } from './grant/interfaces';

const BOUNDED_CONTEXT_NAME = 'auth';
const GRANT_AGGREGATE_NAME = 'grant';

interface BaseLimitPayload {
  receiver: string;
  assetCode: string;
  assetScale: number;
  interval?: string;
}

type ReceiveAmountLimitPayload = BaseLimitPayload & {
  debitAmount?: bigint;
  receiveAmount: bigint;
};

type DebitAmountLimitPayload = BaseLimitPayload & {
  debitAmount: bigint;
  receiveAmount?: bigint;
};

type LimitPayload = ReceiveAmountLimitPayload | DebitAmountLimitPayload;

interface SubjectId {
  format: string;
  id: string;
}

abstract class AuthCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = GRANT_AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.AuthCommands;
  payload: unknown;

  constructor(aggId: string, requestId: string) {
    super(aggId);
    this.msgKey = aggId;
    this.requestId = requestId;
  }
}

export interface SignedCommandPayload {
  client: string;
  signatureData: {
    url: string;
    method: string;
    body: string;
    headers: Record<string, string>;
    kid: string;
  };
}

export interface CreateGrantCmdPayload extends SignedCommandPayload {
  id: string;
  access: {
    identifier?: string;
    type: string;
    actions: string[];
    limits?: LimitPayload;
  }[];
  interact?: {
    start: string[];
    finish?: {
      method: string;
      uri: string;
      nonce: string;
    };
  };
  subjectIds?: SubjectId[];
}

export class CreateGrantCmd extends AuthCmd {
  payload: CreateGrantCmdPayload;

  constructor(payload: CreateGrantCmdPayload, requestId: string) {
    super(payload.id, requestId);
    this.payload = payload;
  }
}

export interface RevokeGrantCmdPayload
  extends Omit<SignedCommandPayload, 'client'> {
  id: string;
  continueId: string;
  continueToken: string;
}

export class RevokeGrantCmd extends AuthCmd {
  payload: RevokeGrantCmdPayload;

  constructor(payload: RevokeGrantCmdPayload, requestId: string) {
    super(payload.id, requestId);
    this.payload = payload;
  }
}

export interface AdminRevokeGrantCmdPayload {
  id: string;
}

export class AdminRevokeGrantCmd extends AuthCmd {
  payload: AdminRevokeGrantCmdPayload;

  constructor(payload: AdminRevokeGrantCmdPayload, requestId: string) {
    super(payload.id, requestId);
    this.payload = payload;
  }
}

export interface ContinueGrantCmdPayload
  extends Omit<SignedCommandPayload, 'client'> {
  id: string;
  continueId: string;
  continueToken: string;
  interactRef?: string;
}

export class ContinueGrantCmd extends AuthCmd {
  payload: ContinueGrantCmdPayload;

  constructor(payload: ContinueGrantCmdPayload, requestId: string) {
    super(payload.id, requestId);
    this.payload = payload;
  }
}

export interface IntrospectTokenCmdPayload {
  id: string;
  tokenValue: string;
  access?: IAccessItem[];
}

export class IntrospectTokenCmd extends AuthCmd {
  payload: IntrospectTokenCmdPayload;

  constructor(payload: IntrospectTokenCmdPayload, requestId: string) {
    super(payload.id, requestId);
    this.payload = payload;
  }
}

export interface RotateTokenCmdPayload
  extends Omit<SignedCommandPayload, 'client'> {
  id: string;
  value: string;
  managementId: string;
}

export class RotateTokenCmd extends AuthCmd {
  payload: RotateTokenCmdPayload;

  constructor(payload: RotateTokenCmdPayload, requestId: string) {
    super(payload.id, requestId);
    this.payload = payload;
  }
}

export interface RevokeTokenCmdPayload
  extends Omit<SignedCommandPayload, 'client'> {
  id: string;
  value: string;
  managementId: string;
}

export class RevokeTokenCmd extends AuthCmd {
  payload: RevokeTokenCmdPayload;

  constructor(payload: RevokeTokenCmdPayload, requestId: string) {
    super(payload.id, requestId);
    this.payload = payload;
  }
}

export interface StartInteractionCmdPayload {
  id: string;
}

export class StartInteractionCmd extends AuthCmd {
  payload: StartInteractionCmdPayload;

  constructor(payload: StartInteractionCmdPayload, requestId: string) {
    super(payload.id, requestId);
    this.payload = payload;
  }
}

export interface FinishInteractionCmdPayload {
  id: string;
  nonce: string;
}

export class FinishInteractionCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = GRANT_AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.AuthCommands;
  payload: FinishInteractionCmdPayload;

  constructor(payload: FinishInteractionCmdPayload, requestId: string) {
    super(payload.id);
    this.requestId = requestId;
    this.msgKey = payload.id;
    this.payload = payload;
  }
}

export interface HandleInteractionChoiceCmdPayload {
  id: string;
}

class HandleInteractionChoiceCmd extends AuthCmd {
  payload: HandleInteractionChoiceCmdPayload;

  constructor(payload: HandleInteractionChoiceCmdPayload, requestId: string) {
    super(payload.id, requestId);
    this.msgKey = payload.id;
    this.payload = payload;
  }
}

export class AcceptInteractionCmd extends HandleInteractionChoiceCmd {}
export class RejectInteractionCmd extends HandleInteractionChoiceCmd {}

export interface ValidateOutgoingPaymentGrantLimitCmdPayload {
  id: string;
  debitAmountValue: string;
  receiveAmountValue: string;
  createdAt: string;
}

export class ValidateOutgoingPaymentGrantLimitCmd extends AuthCmd {
  payload: ValidateOutgoingPaymentGrantLimitCmdPayload;

  constructor(
    payload: ValidateOutgoingPaymentGrantLimitCmdPayload,
    requestId: string
  ) {
    super(payload.id, requestId);
    this.msgKey = payload.id;
    this.payload = payload;
  }
}
