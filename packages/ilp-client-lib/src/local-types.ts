export interface IIlpClientHttpOutgoing {
  endpoint: string;
  callbackEndpoint: string;
  authToken: string;
}

export interface IIlpClientHttpIncoming {
  authToken?: string;
}

export interface IIlpClientHttp {
  outgoing: IIlpClientHttpOutgoing;
  incoming?: IIlpClientHttpIncoming;
}

export interface IIlpClientPeer {
  id: string;
  http: IIlpClientHttp;
  isActive?: boolean;
  maxPacketAmount?: string;
}

export class IlpClientUnknownError extends Error {}
export class IlpClientPeerAlreadyExistsError extends Error {}
export class IlpClientPeerNotFoundError extends Error {}
