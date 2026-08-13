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

export class CreateGrantCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = GRANT_AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.AuthCommands;
  payload: CreateGrantCmdPayload;

  constructor(payload: CreateGrantCmdPayload, requestId: string) {
    super(payload.id);
    this.requestId = requestId;
    this.msgKey = payload.id;
    this.payload = payload;
  }
}

export interface RevokeGrantCmdPayload {
  id: string;
  continueId: string;
  continueToken: string;
}

export class RevokeGrantCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = GRANT_AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.AuthCommands;
  payload: RevokeGrantCmdPayload;

  constructor(payload: RevokeGrantCmdPayload, requestId: string) {
    super(payload.id);
    this.requestId = requestId;
    this.msgKey = payload.id;
    this.payload = payload;
  }
}

export interface ContinueGrantCmdPayload {
  id: string;
  continueId: string;
  continueToken: string;
  interactRef: string;
}

export class ContinueGrantCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = GRANT_AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.AuthCommands;
  payload: ContinueGrantCmdPayload;

  constructor(payload: ContinueGrantCmdPayload, requestId: string) {
    super(payload.id);
    this.requestId = requestId;
    this.msgKey = payload.id;
    this.payload = payload;
  }
}

export interface IntrospectTokenCmdPayload {
  id: string;
  tokenValue: string;
  access?: IAccessItem[];
}

export class IntrospectTokenCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = GRANT_AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.AuthCommands;
  payload: IntrospectTokenCmdPayload;

  constructor(payload: IntrospectTokenCmdPayload, requestId: string) {
    super(payload.id);
    this.requestId = requestId;
    this.msgKey = payload.id;
    this.payload = payload;
  }
}

export interface RotateTokenCmdPayload {
  id: string;
  value: string;
  managementId: string;
}

export class RotateTokenCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = GRANT_AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.AuthCommands;
  payload: RotateTokenCmdPayload;

  constructor(payload: RotateTokenCmdPayload, requestId: string) {
    super(payload.id);
    this.requestId = requestId;
    this.msgKey = payload.id;
    this.payload = payload;
  }
}

export interface RevokeTokenCmdPayload {
  id: string;
  value: string;
  managementId: string;
}

export class RevokeTokenCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = GRANT_AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.AuthCommands;
  payload: RevokeTokenCmdPayload;

  constructor(payload: RevokeTokenCmdPayload, requestId: string) {
    super(payload.id);
    this.requestId = requestId;
    this.msgKey = payload.id;
    this.payload = payload;
  }
}

export interface HandleInteractionChoiceCmdPayload {
  id: string;
  nonce: string;
  interactRef?: string;
}

class HandleInteractionChoiceCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = GRANT_AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.AuthCommands;
  payload: HandleInteractionChoiceCmdPayload;

  constructor(payload: HandleInteractionChoiceCmdPayload, requestId: string) {
    super(payload.id);
    this.requestId = requestId;
    this.msgKey = payload.id;
    this.payload = payload;
  }
}

export class AcceptInteractionCommand extends HandleInteractionChoiceCmd {}
export class RejectInteractionCommand extends HandleInteractionChoiceCmd {}
