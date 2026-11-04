export interface IClientErrorResponse {
  error: {
    code: string;
    description: string;
  };
}

export interface SignatureRequestData {
  url: string;
  method: string;
  body?: string;
  kid: string;
  headers: Record<string, string>;
}

interface AmountInput {
  value: string;
  assetCode: string;
  assetScale: number;
}

export interface AccessLimits {
  receiver?: string;
  interval?: string;
  debitAmount?: AmountInput;
  receiveAmount?: AmountInput;
}

export interface AccessItem {
  type: string;
  actions: string[];
  identifier?: string;
  limits?: AccessLimits;
}

export interface SubjectId {
  format: string;
  id: string;
}

export interface GrantFinish {
  method: string;
  uri: string;
  nonce: string;
}

export interface BaseCreateGrantOptions {
  finish?: GrantFinish;
  subjectIds?: SubjectId[];
  access?: AccessItem[];
  start: string[];
}

export type CreateGrantOptions =
  | (BaseCreateGrantOptions & { access: AccessItem[] })
  | (BaseCreateGrantOptions & { subjectIds: SubjectId[] });

export interface InteractionResult {
  interactRef: string;
  clientNonce: string;
  state: string;
  expiresAt: number;
}

export interface GetGrantResult {
  id: string;
  startMethods?: string[];
  continueToken: string;
  continueId: string;
  interactionNonce: string;
  state: string;
  client: string;
  subjectIds: SubjectId[];
  accesses: AccessItem[];
  finishMethod: string;
  finishUri: string;
  finishNonce: string;
  interaction?: InteractionResult;
  lastContinuedAt: string;
}

export interface CreateGrantResult {
  id: string;
  continueId: string;
  continueToken: string;
  interactionNonce?: string;
  accessTokenValue?: string;
  accessTokenManagementId?: string;
  accessTokenExpiresIn?: number;
  access: AccessItem[];
  subjectIds: SubjectId[];
}

export interface ContinueGrantResult {
  id: string;
  accessTokenValue?: string;
  accessTokenManagementId?: string;
  accessTokenExpiresIn?: number;
  access: AccessItem[];
  continueId: string;
  continueToken: string;
}

export interface RevokeGrantResult {
  id: string;
}

export interface IntrospectTokenResult {
  active: boolean;
  grantId: string;
  access: AccessItem[];
}

export interface RotateTokenResult {
  grantId: string;
  newAccessTokenValue: string;
  newAccessTokenManagementId: string;
  newAccessTokenExpiresIn: number;
  access: AccessItem[];
}

export interface RevokeTokenResult {
  id: string;
}

export interface StartInteractionResult {
  id: string;
  nonce: string;
  clientUri: string;
  clientName: string;
}

export interface HandleInteractionChoiceResult {
  success: boolean;
}

export interface FinishInteractionResult {
  id: string;
  interactNonce: string;
  clientNonce: string;
  interactRef: string;
  finishUri?: string;
}
