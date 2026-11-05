import {
  InvalidAuthToken,
  InvalidHTTPEndpoint,
  InvalidMaxPacketAmount
} from './errors';
import { IPeer, PeerHttpConfig } from './interfaces';

export class Peer implements IPeer {
  private constructor(
    public readonly peerId: string,
    public readonly http: PeerHttpConfig,
    public readonly isActive: boolean | undefined,
    public readonly maxPacketAmount: string | undefined
  ) {}

  static create(args: {
    peerId: string;
    http: PeerHttpConfig;
    isActive?: boolean;
    maxPacketAmount?: string;
  }): Peer {
    Peer.assertHttpEndpoint(args.http.outgoing.endpoint);
    Peer.assertHttpEndpoint(args.http.outgoing.callbackEndpoint);
    Peer.assertAuthToken(
      args.http.outgoing.authToken,
      'http.outgoing.authToken'
    );

    if (args.http.incoming?.authToken !== undefined) {
      Peer.assertAuthToken(
        args.http.incoming.authToken,
        'http.incoming.authToken'
      );
    }

    const maxPacketAmount = Peer.assertMaxPacketAmount(args.maxPacketAmount);

    return new Peer(args.peerId, args.http, args.isActive, maxPacketAmount);
  }

  static fromObject(peer: IPeer): Peer {
    return Peer.create({
      peerId: peer.peerId,
      http: peer.http,
      isActive: peer.isActive,
      maxPacketAmount: peer.maxPacketAmount
    });
  }

  toObject(): IPeer {
    return {
      peerId: this.peerId,
      http: this.http,
      isActive: this.isActive,
      ...(this.maxPacketAmount !== undefined
        ? { maxPacketAmount: this.maxPacketAmount }
        : {})
    };
  }

  private static assertHttpEndpoint(value: string): void {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new InvalidHTTPEndpoint(`Invalid HTTP endpoint: ${value}`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new InvalidHTTPEndpoint(
        `Invalid HTTP endpoint protocol for ${value}: ${parsed.protocol}`
      );
    }
  }

  private static assertAuthToken(value: string, field: string): void {
    if (value.trim().length === 0) {
      throw new InvalidAuthToken(`${field} must not be empty`);
    }
  }

  private static assertMaxPacketAmount(
    value: string | undefined
  ): string | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (!/^\d+$/.test(value)) {
      throw new InvalidMaxPacketAmount(
        `maxPacketAmount must be a non-negative integer string, got: ${value}`
      );
    }
    return value;
  }
}
