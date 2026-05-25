import { CommandMsg, CommandTopics } from 'common-types-lib';

const BOUNDED_CONTEXT_NAME = 'auth';
const GRANT_AGGREGATE_NAME = 'grant';

interface LimitPayload {
  receiver: string;
  assetCode: string;
  assetScale: number;
  debitAmount?: bigint;
  sendAmount?: bigint;
  interval?: string;
}

interface SubjectId {
  format: string;
  id: string;
}

interface JsonWebKey {
  kty: string;
  kid: string;
  use?: string;
  alg: string;
  crv: string;
  x: string;
}

export interface CreateGrantCmdPayload {
  id: string;
  access: {
    identifier?: string;
    type: string;
    actions: string[];
    limits?: LimitPayload;
  }[];
  client?: string | JsonWebKey;
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
  tenantId: string;
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

export interface RotateAccessTokenCmdPayload {
  id: string;
  value: string;
  managementId: string;
}

export class RotateAccessTokenCmd extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = GRANT_AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.AuthCommands;
  payload: RotateAccessTokenCmdPayload;

  constructor(payload: RotateAccessTokenCmdPayload, requestId: string) {
    super(payload.id);
    this.requestId = requestId;
    this.msgKey = payload.id;
    this.payload = payload;
  }
}

export interface RevokeAccessTokenCmdPayload {
  id: string;
  value: string;
  managementId: string;
}

export class RevokeAccessTokenCommand extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = GRANT_AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.AuthCommands;
  payload: RevokeAccessTokenCmdPayload;

  constructor(payload: RevokeAccessTokenCmdPayload, requestId: string) {
    super(payload.id);
    this.requestId = requestId;
    this.msgKey = payload.id;
    this.payload = payload;
  }
}

export interface InteractionChoiceCmdPayload {
  id: string;
  interactId: string;
  nonce: string;
}

class InteractionChoiceCommand extends CommandMsg {
  contextName: string = BOUNDED_CONTEXT_NAME;
  aggregateName: string = GRANT_AGGREGATE_NAME;
  msgKey: string;
  msgTopic: string = CommandTopics.AuthCommands;
  payload: InteractionChoiceCmdPayload;

  constructor(payload: InteractionChoiceCmdPayload, requestId: string) {
    super(payload.id);
    this.requestId = requestId;
    this.msgKey = payload.id;
    this.payload = payload;
  }
}

export class InteractionApprovedCommand extends InteractionChoiceCommand {}
export class InteractionDeniedCommand extends InteractionChoiceCommand {}
