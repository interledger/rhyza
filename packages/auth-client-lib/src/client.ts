import * as grpc from '@grpc/grpc-js';
import { ServiceError } from '@grpc/grpc-js';
import {
  RafikiAuthClient,
  GrantRequest as PbGrantRequest,
  Grant as PbGrant,
  GetGrantRequest as PbGetGrantRequest,
  AccessLimits as PbAccessLimits,
  Interaction as PbInteraction,
  GrantRequestFinish as PbGrantRequestFinish,
  SignatureData as PbSignatureData,
  RevokeGrantResponse as PbRevokeGrantResponse,
  ContinueGrantResponse as PbContinueGrantResponse,
  RotateTokenResponse as PbRotateTokenResponse,
  RevokeTokenResponse as PbRevokeTokenResponse,
  CreateGrantResponse as PbCreateGrantResponse,
  StartInteractionResponse as PbStartInteractionResponse,
  StartInteractionRequest as PbStartInteractionRequest,
  HandleInteractionChoiceResponse as PbHandleInteractionChoiceResponse,
  AcceptInteractionRequest as PbAcceptInteractionRequest,
  RejectInteractionRequest as PbRejectInteractionRequest,
  FinishInteractionRequest as PbFinishInteractionRequest,
  FinishInteractionResponse as PbFinishInteractionResponse,
  ContinueGrantRequest as PbContinueGrantRequest,
  RevokeGrantRequest as PbRevokeGrantRequest,
  IntrospectTokenResponse as PbIntrospectTokenResponse,
  IntrospectTokenRequest as PbIntrospectTokenRequest,
  RotateTokenRequest as PbRotateTokenRequest,
  RevokeTokenRequest as PbRevokeTokenRequest,
  AccessItem as PbAccessItem,
  SubjectId as PbSubjectId
} from 'auth-public-types-lib';
import {
  AccessItem,
  AccessLimits,
  ContinueGrantResult,
  CreateGrantOptions,
  CreateGrantResult,
  FinishInteractionResult,
  GetGrantResult,
  GrantFinish,
  HandleInteractionChoiceResult,
  InteractionResult,
  IntrospectTokenResult,
  RevokeGrantResult,
  RevokeTokenResult,
  RotateTokenResult,
  SignatureRequestData,
  StartInteractionResult,
  SubjectId
} from './types';
import { AuthClientUnknownError } from './errors';

export class AuthClient {
  private readonly _serverUrl: string;
  private readonly _grpcConnectTimeOutMs: number;
  private readonly _grpcClient: RafikiAuthClient;

  constructor(serverUrl: string, grpcConnectTimeOutMs: number = 5_000) {
    this._serverUrl = serverUrl;
    this._grpcConnectTimeOutMs = grpcConnectTimeOutMs;

    this._grpcClient = new RafikiAuthClient(
      this._serverUrl,
      grpc.credentials.createInsecure(),
      {
        'grpc.max_receive_message_length': 100 * 1024 * 1024,
        'grpc.max_send_message_length': 100 * 1024 * 1024,
        'grpc.keepalive_time_ms': 10000,
        'grpc.keepalive_timeout_ms': 5000,
        'grpc.keepalive_permit_without_calls': 1
      }
    );
  }

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const deadline: grpc.Deadline = Date.now() + this._grpcConnectTimeOutMs;
      this._grpcClient.waitForReady(deadline, (error?: Error) => {
        if (error) return reject(error);
        return resolve();
      });
    });
  }

  async disconnect(): Promise<void> {
    this._grpcClient.close();
    return Promise.resolve();
  }

  getGrant(id: string): Promise<GetGrantResult | null> {
    const request = new PbGetGrantRequest();
    request.setId(id);

    return new Promise((resolve, reject) => {
      this._grpcClient.getGrant(
        request,
        (error: ServiceError | null, response: PbGrant) => {
          if (error) {
            if (error.code === grpc.status.NOT_FOUND) {
              resolve(null);
            }
            return reject(new AuthClientUnknownError(error.message));
          } else {
            resolve(fromPbGrant(response));
          }
        }
      );
    });
  }

  createGrant(
    client: string,
    signatureData: SignatureRequestData,
    options: CreateGrantOptions
  ): Promise<CreateGrantResult> {
    const request = new PbGrantRequest();
    request.setStartList(options.start);

    if (options.access) {
      request.setAccessList(options.access.map(toPbAccessItem));
    }
    request.setClient(client);
    if (options.subjectIds) {
      request.setSubjectIdsList(options.subjectIds.map(toPbSubjectId));
    }
    if (options.finish) {
      request.setFinish(toPbGrantRequestFinish(options.finish));
    }

    request.setSignatureData(this.toSignatureData(signatureData));

    return new Promise((resolve, reject) => {
      this._grpcClient.createGrant(
        request,
        (error: ServiceError | null, response: PbCreateGrantResponse) => {
          if (error) {
            reject(new AuthClientUnknownError(error.message));
          } else {
            resolve(fromPbCreateGrantResponse(response));
          }
        }
      );
    });
  }

  continueGrant(
    id: string,
    signatureData: SignatureRequestData,
    continueId: string,
    continueToken: string,
    interactRef?: string
  ): Promise<ContinueGrantResult> {
    const request = new PbContinueGrantRequest();
    request.setId(id);
    request.setContinueId(continueId);
    request.setContinueToken(continueToken);
    if (interactRef) request.setInteractRef(interactRef);
    request.setSignatureData(this.toSignatureData(signatureData));

    return new Promise((resolve, reject) => {
      this._grpcClient.continueGrant(
        request,
        (error: ServiceError | null, response: PbContinueGrantResponse) => {
          if (error) {
            reject(new AuthClientUnknownError(error.message));
          } else {
            resolve(fromPbContinueGrantResponse(response));
          }
        }
      );
    });
  }

  private toSignatureData(
    signatureData: SignatureRequestData
  ): PbSignatureData {
    const msg = new PbSignatureData();
    msg.setUrl(signatureData.url);
    msg.setMethod(signatureData.method);
    msg.setBody(signatureData.body);
    msg.setKid(signatureData.kid);
    msg.setHeaders(JSON.stringify(signatureData.headers));
    return msg;
  }

  revokeGrant(
    id: string,
    signatureData: SignatureRequestData,
    continueId: string,
    continueToken: string
  ): Promise<RevokeGrantResult> {
    const request = new PbRevokeGrantRequest();
    request.setId(id);
    request.setContinueId(continueId);
    request.setContinueToken(continueToken);
    request.setSignatureData(this.toSignatureData(signatureData));

    return new Promise((resolve, reject) => {
      this._grpcClient.revokeGrant(
        request,
        (error: ServiceError | null, response: PbRevokeGrantResponse) => {
          if (error) {
            reject(new AuthClientUnknownError(error.message));
          } else {
            resolve({ id: response.getId() });
          }
        }
      );
    });
  }

  introspectToken(
    id: string,
    tokenValue: string,
    access: AccessItem[]
  ): Promise<IntrospectTokenResult> {
    const request = new PbIntrospectTokenRequest();
    request.setId(id);
    request.setTokenValue(tokenValue);
    request.setAccessList(access.map(toPbAccessItem));

    return new Promise((resolve, reject) => {
      this._grpcClient.introspectToken(
        request,
        (error: ServiceError | null, response: PbIntrospectTokenResponse) => {
          if (error) {
            reject(new AuthClientUnknownError(error.message));
          } else {
            resolve(fromPbIntrospectTokenResponse(response));
          }
        }
      );
    });
  }

  rotateToken(
    id: string,
    signatureData: SignatureRequestData,
    tokenValue: string,
    managementId: string
  ): Promise<RotateTokenResult> {
    const request = new PbRotateTokenRequest();
    request.setId(id);
    request.setTokenValue(tokenValue);
    request.setManagementId(managementId);
    request.setSignatureData(this.toSignatureData(signatureData));

    return new Promise((resolve, reject) => {
      this._grpcClient.rotateToken(
        request,
        (error: ServiceError | null, response: PbRotateTokenResponse) => {
          if (error) {
            reject(new AuthClientUnknownError(error.message));
          } else {
            resolve(fromPbRotateTokenResponse(response));
          }
        }
      );
    });
  }

  revokeToken(
    id: string,
    signatureData: SignatureRequestData,
    tokenValue: string,
    managementId: string
  ): Promise<RevokeTokenResult> {
    const request = new PbRevokeTokenRequest();
    request.setId(id);
    request.setTokenValue(tokenValue);
    request.setManagementId(managementId);
    request.setSignatureData(this.toSignatureData(signatureData));

    return new Promise((resolve, reject) => {
      this._grpcClient.revokeToken(
        request,
        (error: ServiceError | null, response: PbRevokeTokenResponse) => {
          if (error) {
            reject(new AuthClientUnknownError(error.message));
          } else {
            resolve({ id: response.getId() });
          }
        }
      );
    });
  }

  startInteraction(id: string): Promise<StartInteractionResult> {
    const request = new PbStartInteractionRequest();
    request.setId(id);

    return new Promise((resolve, reject) => {
      this._grpcClient.startInteraction(
        request,
        (error: ServiceError | null, response: PbStartInteractionResponse) => {
          if (error) {
            reject(new AuthClientUnknownError(error.message));
          } else {
            resolve(fromPbStartInteractionResponse(response));
          }
        }
      );
    });
  }

  finishInteraction(
    id: string,
    nonce: string
  ): Promise<FinishInteractionResult> {
    const request = new PbFinishInteractionRequest();
    request.setId(id);
    request.setNonce(nonce);

    return new Promise((resolve, reject) => {
      this._grpcClient.finishInteraction(
        request,
        (error: ServiceError | null, response: PbFinishInteractionResponse) => {
          if (error) {
            reject(new AuthClientUnknownError(error.message));
          } else {
            resolve({
              id: response.getId(),
              interactNonce: response.getInteractNonce(),
              clientNonce: response.getClientNonce(),
              interactRef: response.getInteractRef(),
              finishUri: response.getFinishUri() || undefined
            });
          }
        }
      );
    });
  }

  acceptInteraction(id: string): Promise<HandleInteractionChoiceResult> {
    const request = new PbAcceptInteractionRequest();
    request.setId(id);

    return new Promise((resolve, reject) => {
      this._grpcClient.acceptInteraction(
        request,
        (
          error: ServiceError | null,
          response: PbHandleInteractionChoiceResponse
        ) => {
          if (error) {
            reject(new AuthClientUnknownError(error.message));
          } else {
            resolve({ success: response.getSuccess() });
          }
        }
      );
    });
  }

  rejectInteraction(id: string): Promise<HandleInteractionChoiceResult> {
    const request = new PbRejectInteractionRequest();
    request.setId(id);

    return new Promise((resolve, reject) => {
      this._grpcClient.rejectInteraction(
        request,
        (
          error: ServiceError | null,
          response: PbHandleInteractionChoiceResponse
        ) => {
          if (error) {
            reject(new AuthClientUnknownError(error.message));
          } else {
            resolve({ success: response.getSuccess() });
          }
        }
      );
    });
  }
}

function toPbAccessLimits(input: AccessLimits): PbAccessLimits {
  const accessLimits = new PbAccessLimits();
  if (input.receiver) {
    accessLimits.setReceiver(input.receiver);
  }
  if (input.interval) {
    accessLimits.setInterval(input.interval);
  }

  if (input.debitAmount) {
    accessLimits.setDebitAmountValue(input.debitAmount.value);
    accessLimits.setAssetCode(input.debitAmount.assetCode);
    accessLimits.setAssetScale(input.debitAmount.assetScale);
  } else if (input.receiveAmount) {
    accessLimits.setReceiveAmountValue(input.receiveAmount.value);
    accessLimits.setAssetCode(input.receiveAmount.assetCode);
    accessLimits.setAssetScale(input.receiveAmount.assetScale);
  }

  return accessLimits;
}

function fromPbAccessLimits(
  accessLimits?: PbAccessLimits
): AccessLimits | undefined {
  if (!accessLimits) {
    return undefined;
  }

  const limits: AccessLimits = {};
  if (accessLimits.getReceiver()) {
    limits.receiver = accessLimits.getReceiver();
  }
  if (accessLimits.getInterval()) {
    limits.interval = accessLimits.getInterval();
  }

  if (accessLimits.getDebitAmountValue()) {
    limits.debitAmount = {
      value: accessLimits.getDebitAmountValue(),
      assetCode: accessLimits.getAssetCode(),
      assetScale: accessLimits.getAssetScale()
    };
  } else if (accessLimits.getReceiveAmountValue()) {
    limits.receiveAmount = {
      value: accessLimits.getReceiveAmountValue(),
      assetCode: accessLimits.getAssetCode(),
      assetScale: accessLimits.getAssetScale()
    };
  }

  return limits;
}

function toPbAccessItem(input: AccessItem): PbAccessItem {
  const accessItem = new PbAccessItem();
  accessItem.setType(input.type);
  accessItem.setActionsList(input.actions);
  if (input.identifier) {
    accessItem.setIdentifier(input.identifier);
  }
  if (input.limits) {
    accessItem.setLimits(toPbAccessLimits(input.limits));
  }
  return accessItem;
}

function fromPbAccessItem(accessItem: PbAccessItem): AccessItem {
  const item: AccessItem = {
    type: accessItem.getType(),
    actions: accessItem.getActionsList()
  };

  const identifier = accessItem.getIdentifier();
  if (identifier) {
    item.identifier = identifier;
  }

  const limits = fromPbAccessLimits(accessItem.getLimits());
  if (limits) {
    item.limits = limits;
  }

  return item;
}

function toPbSubjectId(input: SubjectId): PbSubjectId {
  const subjectId = new PbSubjectId();
  subjectId.setFormat(input.format);
  subjectId.setId(input.id);
  return subjectId;
}

function fromPbSubjectId(subjectId: PbSubjectId): SubjectId {
  return { id: subjectId.getId(), format: subjectId.getFormat() };
}

function toPbGrantRequestFinish(input: GrantFinish): PbGrantRequestFinish {
  const finish = new PbGrantRequestFinish();
  finish.setFinish(input.method);
  finish.setUri(input.uri);
  finish.setNonce(input.nonce);
  return finish;
}

function fromPbInteraction(
  interaction?: PbInteraction
): InteractionResult | undefined {
  if (!interaction) {
    return undefined;
  }
  return {
    interactRef: interaction.getInteractRef(),
    clientNonce: interaction.getClientNonce(),
    state: interaction.getState(),
    expiresAt: interaction.getExpiresAt()
  };
}

function fromPbGrant(grant: PbGrant): GetGrantResult {
  return {
    id: grant.getId(),
    startMethods: grant.getStartMethodsList(),
    continueToken: grant.getContinueToken(),
    continueId: grant.getContinueId(),
    interactionNonce: grant.getInteractionNonce(),
    state: grant.getState(),
    client: grant.getClient(),
    subjectIds: grant.getSubjectIdsList().map(fromPbSubjectId),
    accesses: grant.getAccessesList().map(fromPbAccessItem),
    finishMethod: grant.getFinishMethod(),
    finishUri: grant.getFinishUri(),
    finishNonce: grant.getFinishNonce(),
    interaction: fromPbInteraction(grant.getInteraction()),
    lastContinuedAt: grant.getLastContinuedAt()
  };
}

function fromPbCreateGrantResponse(
  response: PbCreateGrantResponse
): CreateGrantResult {
  return {
    id: response.getId(),
    continueId: response.getContinueId(),
    continueToken: response.getContinueToken(),
    interactionNonce: response.getInteractionNonce() || undefined,
    accessTokenValue: response.getAccessTokenValue() || undefined,
    accessTokenManagementId: response.getAccessTokenManagementId() || undefined,
    accessTokenExpiresIn: response.getAccessTokenExpiresIn() || undefined,
    access: response.getAccessList().map(fromPbAccessItem),
    subjectIds: response.getSubIdsList().map(fromPbSubjectId)
  };
}

function fromPbContinueGrantResponse(
  response: PbContinueGrantResponse
): ContinueGrantResult {
  return {
    id: response.getId(),
    accessTokenValue: response.getAccessTokenValue() || undefined,
    accessTokenManagementId: response.getAccessTokenManagementId() || undefined,
    accessTokenExpiresIn: response.getAccessTokenExpiresIn() || undefined,
    access: response.getAccessList().map(fromPbAccessItem),
    continueId: response.getContinueId(),
    continueToken: response.getContinueToken()
  };
}

function fromPbRotateTokenResponse(
  response: PbRotateTokenResponse
): RotateTokenResult {
  return {
    grantId: response.getGrantId(),
    newAccessTokenValue: response.getNewAccessTokenValue(),
    newAccessTokenManagementId: response.getNewAccessTokenManagementId(),
    newAccessTokenExpiresIn: response.getNewAccessTokenExpiresIn(),
    access: response.getAccessList().map(fromPbAccessItem)
  };
}

function fromPbIntrospectTokenResponse(
  response: PbIntrospectTokenResponse
): IntrospectTokenResult {
  return {
    active: response.getActive(),
    grantId: response.getGrantId(),
    access: response.getAccessList().map(fromPbAccessItem)
  };
}

function fromPbStartInteractionResponse(
  response: PbStartInteractionResponse
): StartInteractionResult {
  return {
    id: response.getId(),
    nonce: response.getNonce(),
    clientUri: response.getClientUri(),
    clientName: response.getClientName()
  };
}
