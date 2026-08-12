import { JWK } from '@interledger/http-signature-utils';

export const AccessType = {
  INCOMING_PAYMENT: 'INCOMING_PAYMENT',
  OUTGOING_PAYMENT: 'OUTGOING_PAYMENT',
  QUOTE: 'QUOTE'
} as const;
export type AccessType = keyof typeof AccessType;

export const InteractiveAccessType: AccessType[] = [
  AccessType.OUTGOING_PAYMENT
] as const;

interface IBaseAccessLimit {
  receiver: string;
  assetCode: string;
  assetScale: number;
  interval?: string;
}

type IDebitAmountAccessLimit = IBaseAccessLimit & {
  debitAmount: bigint;
  receiveAmount?: bigint;
};

type IReceiveAmountAccessLimit = IBaseAccessLimit & {
  debitAmount?: bigint;
  receiveAmount: bigint;
};

export type IAccessLimit = IDebitAmountAccessLimit | IReceiveAmountAccessLimit;

export const AccessAction = {
  CREATE: 'CREATE',
  COMPLETE: 'COMPLETE',
  READ: 'READ',
  READ_ALL: 'READ_ALL',
  LIST: 'LIST',
  LIST_ALL: 'LIST_ALL'
} as const;
export type AccessAction = keyof typeof AccessAction;

export interface IAccessItem {
  type: AccessType;
  limits?: IAccessLimit;
  actions: AccessAction[];
  identifier?: string;
}

export interface ISubjectId {
  format: string;
  id: string;
}

export type InteractionChoice =
  | typeof InteractionState.APPROVED
  | typeof InteractionState.DENIED;

export const InteractionState = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  DENIED: 'DENIED'
} as const;
export type InteractionState = keyof typeof InteractionState;

export interface IGrantContinuation {
  accessToken: {
    value: string;
  };
  uri: string;
  wait: number;
}

export const IStartMethod = {
  REDIRECT: 'REDIRECT'
} as const;
export type IStartMethod = keyof typeof IStartMethod;

export const IFinishMethod = {
  REDIRECT: 'REDIRECT'
} as const;
export type IFinishMethod = keyof typeof IFinishMethod;

export interface IGrantFinishMethod {
  method: IFinishMethod;
  uri: string;
  nonce: string;
}

export interface IGrantInteractionMethod {
  start: IStartMethod[];
  finish: IGrantFinishMethod;
}

export interface IAccessRequest {
  actions: AccessAction[];
  identifier?: string;
}

export const GrantState = {
  PROCESSING: 'PROCESSING',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  FINALIZED: 'FINALIZED'
} as const;
export type GrantState = keyof typeof GrantState;

export const GrantFinalization = {
  ISSUED: 'ISSUED',
  REVOKED: 'REVOKED',
  REJECTED: 'REJECTED'
} as const;
export type GrantFinalization = keyof typeof GrantFinalization;

export interface IInteraction {
  interactRef: string;
  state: InteractionState;
  expiresInMs: number;
  clientNonce: string;
}

export interface IGrant {
  id: string;
  startMethods: IStartMethod[];
  continueToken?: string;
  continueId?: string;
  state: GrantState;
  finalizationReason?: GrantFinalization;
  client?: string | IJsonWebKey;
  subjectIds?: ISubjectId[];
  accesses?: IAccessItem[];
  finishNonce?: string;
  finishMethod?: IFinishMethod;
  finishUri?: string;
  interactionNonce?: string;
  interaction?: IInteraction;
  lastContinuedAt?: Date;
  accessTokens: IAccessToken[];
}

export type NewAccessToken = Omit<IAccessToken, 'revokedAt'>;

export type RevokedAccessToken = IAccessToken & {
  revokedAt: Date;
};

export interface IAccessToken {
  value: string;
  managementId: string;
  expiresInMs: number;
  createdAt: Date;
  revokedAt?: Date;
}

export interface IJsonWebKey {
  kty: string;
  kid: string;
  use?: string;
  alg: string;
  crv: string;
  x: string;
}

export function isJWK(obj: unknown): obj is JWK {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof (obj as Record<string, unknown>).kid === 'string' &&
    (obj as Record<string, unknown>).alg === 'EdDSA' &&
    (typeof (obj as Record<string, unknown>).use === 'string' ||
      typeof (obj as Record<string, unknown>).use === 'undefined') &&
    (obj as Record<string, unknown>).kty === 'OKP' &&
    (obj as Record<string, unknown>).crv === 'Ed25519' &&
    typeof (obj as Record<string, unknown>).x === 'string'
  );
}

export interface IAccessRequest {
  actions: AccessAction[];
  identifier?: string;
}

export interface IWalletAddressService {
  getWalletAddressKeys(url: string): Promise<IJsonWebKey[]>;
}

export interface IGrantRepository {
  storeMany(grants: IGrant[]): Promise<void>;
  fetchById(id: string): Promise<IGrant | undefined>;
  fetchByIds(ids: string[]): Promise<IGrant[]>;
}
