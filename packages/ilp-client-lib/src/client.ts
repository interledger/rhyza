import * as grpc from '@grpc/grpc-js';
import { ServiceError } from '@grpc/grpc-js';
import {
  IIlpClientHttp,
  IIlpClientPeer,
  IlpClientPeerAlreadyExistsError,
  IlpClientPeerNotFoundError,
  IlpClientUnknownError
} from './local-types';
import {
  CreatePeerRequest,
  GetPeerRequest,
  IlpGrpcClient,
  ListPeersRequest,
  Peer as PbPeer,
  PeerHttpIncomingSettings,
  PeerHttpOutgoingSettings,
  PeerHttpSettings,
  UpdatePeerRequest
} from 'ilp-public-types-lib';
import process from 'process';

const DEFAULT_GRPC_KEEPALIVE_TIME_MS =
  (process.env['DEFAULT_GRPC_KEEPALIVE_TIME_MS'] &&
    parseInt(process.env['DEFAULT_GRPC_KEEPALIVE_TIME_MS'])) ||
  10_000;
const DEFAULT_GRPC_KEEPALIVE_TIMEOUT_MS =
  (process.env['DEFAULT_GRPC_KEEPALIVE_TIMEOUT_MS'] &&
    parseInt(process.env['DEFAULT_GRPC_KEEPALIVE_TIMEOUT_MS'])) ||
  5_000;

export class IlpClient {
  private readonly _serverUrl: string;
  private readonly _grpcConnectTimeOutMs: number;
  private readonly _grpcClient: IlpGrpcClient;

  constructor(serverUrl: string, grpcConnectTimeOutMs: number = 5_000) {
    this._serverUrl = serverUrl;
    this._grpcConnectTimeOutMs = grpcConnectTimeOutMs;

    this._grpcClient = new IlpGrpcClient(
      this._serverUrl,
      grpc.credentials.createInsecure(),
      {
        'grpc.max_receive_message_length': 100 * 1024 * 1024,
        'grpc.max_send_message_length': 100 * 1024 * 1024,
        'grpc.keepalive_time_ms': DEFAULT_GRPC_KEEPALIVE_TIME_MS,
        'grpc.keepalive_timeout_ms': DEFAULT_GRPC_KEEPALIVE_TIMEOUT_MS,
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

  private _pbHttpFromHttp(http: IIlpClientHttp): PeerHttpSettings {
    const outgoing = new PeerHttpOutgoingSettings()
      .setEndpoint(http.outgoing.endpoint)
      .setCallbackEndpoint(http.outgoing.callbackEndpoint)
      .setAuthToken(http.outgoing.authToken);

    const pbHttp = new PeerHttpSettings().setOutgoing(outgoing);
    if (http.incoming?.authToken !== undefined) {
      pbHttp.setIncoming(
        new PeerHttpIncomingSettings().setAuthToken(http.incoming.authToken)
      );
    }
    return pbHttp;
  }

  private _peerFromPbPeer(pbPeer: PbPeer): IIlpClientPeer {
    const http = pbPeer.getHttp();
    if (!http || !http.getOutgoing()) {
      throw new IlpClientUnknownError(
        `Peer ${pbPeer.getId()} response is missing http.outgoing`
      );
    }
    const outgoing = http.getOutgoing()!;
    const incoming = http.getIncoming();

    return {
      id: pbPeer.getId(),
      http: {
        outgoing: {
          endpoint: outgoing.getEndpoint(),
          callbackEndpoint: outgoing.getCallbackEndpoint(),
          authToken: outgoing.getAuthToken()
        },
        ...(incoming
          ? { incoming: { authToken: incoming.getAuthToken() } }
          : {})
      },
      isActive: pbPeer.hasIsActive() ? pbPeer.getIsActive() : undefined,
      maxPacketAmount: pbPeer.hasMaxPacketAmount()
        ? String(pbPeer.getMaxPacketAmount())
        : undefined
    };
  }

  createPeer(
    peerId: string,
    http: IIlpClientHttp,
    isActive?: boolean,
    maxPacketAmount?: string
  ): Promise<IIlpClientPeer> {
    const pbPeer = new PbPeer()
      .setId(peerId)
      .setHttp(this._pbHttpFromHttp(http));
    if (isActive !== undefined) {
      pbPeer.setIsActive(isActive);
    }
    if (maxPacketAmount !== undefined) {
      // jspb uint64 accepts string at runtime; preserves full range.
      pbPeer.setMaxPacketAmount(maxPacketAmount as unknown as number);
    }

    const request = new CreatePeerRequest().setPeer(pbPeer);

    return new Promise((resolve, reject) => {
      this._grpcClient.createPeer(
        request,
        (error: ServiceError | null, response) => {
          if (error) {
            if (error.code == grpc.status.ALREADY_EXISTS) {
              return reject(new IlpClientPeerAlreadyExistsError(error.message));
            }
            return reject(new IlpClientUnknownError(error.message));
          }
          const responsePeer = response?.getPeer();
          if (!responsePeer) {
            return reject(
              new IlpClientUnknownError('CreatePeer response is missing peer')
            );
          }
          return resolve(this._peerFromPbPeer(responsePeer));
        }
      );
    });
  }

  updatePeer(
    peerId: string,
    http: IIlpClientHttp,
    isActive?: boolean,
    maxPacketAmount?: string
  ): Promise<IIlpClientPeer> {
    const pbPeer = new PbPeer()
      .setId(peerId)
      .setHttp(this._pbHttpFromHttp(http));
    if (isActive !== undefined) {
      pbPeer.setIsActive(isActive);
    }
    if (maxPacketAmount !== undefined) {
      pbPeer.setMaxPacketAmount(maxPacketAmount as unknown as number);
    }

    const request = new UpdatePeerRequest().setPeer(pbPeer);

    return new Promise((resolve, reject) => {
      this._grpcClient.updatePeer(
        request,
        (error: ServiceError | null, response) => {
          if (error) {
            if (error.code == grpc.status.NOT_FOUND) {
              return reject(new IlpClientPeerNotFoundError(error.message));
            }
            return reject(new IlpClientUnknownError(error.message));
          }
          const responsePeer = response?.getPeer();
          if (!responsePeer) {
            return reject(
              new IlpClientUnknownError('UpdatePeer response is missing peer')
            );
          }
          return resolve(this._peerFromPbPeer(responsePeer));
        }
      );
    });
  }

  getPeer(peerId: string): Promise<IIlpClientPeer | null> {
    const request = new GetPeerRequest().setId(peerId);

    return new Promise((resolve, reject) => {
      this._grpcClient.getPeer(
        request,
        (error: ServiceError | null, response) => {
          if (error) {
            return reject(new IlpClientUnknownError(error.message));
          }
          const responsePeer = response?.getPeer();
          return resolve(
            responsePeer ? this._peerFromPbPeer(responsePeer) : null
          );
        }
      );
    });
  }

  listPeers(): Promise<IIlpClientPeer[]> {
    const request = new ListPeersRequest();

    return new Promise((resolve, reject) => {
      this._grpcClient.listPeers(
        request,
        (error: ServiceError | null, response) => {
          if (error) {
            return reject(new IlpClientUnknownError(error.message));
          }
          const peers = response?.getPeersList() ?? [];
          return resolve(peers.map((p) => this._peerFromPbPeer(p)));
        }
      );
    });
  }
}
