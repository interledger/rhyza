import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConsoleLogger, ILogger } from 'common-types-lib';
import {
  deserializeIlpPrepare,
  deserializeIlpReply,
  isFulfill,
  serializeIlpFulfill,
  serializeIlpPrepare,
  serializeIlpReject
} from 'ilp-packet';
import { PeerDirectory } from './peer-directory';
import {
  IConnectorTransport,
  WireFulfill,
  WireInboundPrepareHandler,
  WireOutboundPrepareAcceptedHandler,
  WirePrepare,
  WireReject,
  WireResponse,
  WireResponseHandler
} from './transport';

const ILP_CONTENT_TYPE = 'application/octet-stream';
const DEFAULT_PATH = '/ilp';
const DEFAULT_CALLBACK_PATH = '/ilp/callback';
const DEFAULT_ACCEPT_TIMEOUT_MS = 5_000;
const DEFAULT_CALLBACK_RETRY_DELAY_MS = 500;
const REQUEST_ID_HEADER = 'request-id';
const CALLBACK_URL_HEADER = 'callback-url';

export interface HttpConnectorTransportOptions {
  directory: PeerDirectory;
  port: number;
  publicBaseUrl?: string;
  path?: string;
  callbackPath?: string;
  logger?: ILogger;
  acceptTimeoutMs?: number;
  callbackRetryDelayMs?: number;
}

export class HttpConnectorTransport implements IConnectorTransport {
  private readonly _directory: PeerDirectory;
  private readonly _port: number;
  private readonly _publicBaseUrl?: string;
  private readonly _path: string;
  private readonly _callbackPath: string;
  private readonly _logger: ILogger;
  private readonly _acceptTimeoutMs: number;
  private readonly _callbackRetryDelayMs: number;

  private _server?: http.Server;
  private _responseHandler?: WireResponseHandler;
  private _inboundPrepareHandler?: WireInboundPrepareHandler;
  private _outboundPrepareAcceptedHandler?: WireOutboundPrepareAcceptedHandler;

  constructor(options: HttpConnectorTransportOptions) {
    this._directory = options.directory;
    this._port = options.port;
    this._publicBaseUrl = options.publicBaseUrl
      ? trimTrailingSlashes(options.publicBaseUrl)
      : undefined;
    this._path = options.path ?? DEFAULT_PATH;
    this._callbackPath = options.callbackPath ?? DEFAULT_CALLBACK_PATH;
    this._logger = options.logger ?? new ConsoleLogger();
    this._acceptTimeoutMs =
      options.acceptTimeoutMs ?? DEFAULT_ACCEPT_TIMEOUT_MS;
    this._callbackRetryDelayMs =
      options.callbackRetryDelayMs ?? DEFAULT_CALLBACK_RETRY_DELAY_MS;
  }

  async start(): Promise<void> {
    this._server = http.createServer((req, res) =>
      this._handleRequest(req, res)
    );
    await new Promise<void>((resolve) => {
      this._server!.listen(this._port, resolve);
    });
    this._logger.info(
      `HttpConnectorTransport listening on :${this._port} (prepares: ${this._path}, callbacks: ${this._callbackPath})`
    );
  }

  async stop(): Promise<void> {
    const server = this._server;
    this._server = undefined;
    if (!server) return;

    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  get boundPort(): number | undefined {
    const address = this._server?.address();
    return address && typeof address === 'object'
      ? (address as AddressInfo).port
      : undefined;
  }

  private get _resolvedPublicBaseUrl(): string {
    return this._publicBaseUrl ?? `http://127.0.0.1:${this.boundPort}`;
  }

  onResponse(handler: WireResponseHandler): void {
    this._responseHandler = handler;
  }

  onInboundPrepare(handler: WireInboundPrepareHandler): void {
    this._inboundPrepareHandler = handler;
  }

  onOutboundPrepareAccepted(handler: WireOutboundPrepareAcceptedHandler): void {
    this._outboundPrepareAcceptedHandler = handler;
  }

  async sendPrepare(prepare: WirePrepare): Promise<void> {
    const outgoing = this._directory.getOutgoing(prepare.peerId);
    if (!outgoing) {
      this._logger.warn(
        `No outgoing connector config for peer ${prepare.peerId}; rejecting packet ${prepare.packetId}`
      );
      await this._deliverResponse({
        kind: 'REJECT',
        packetId: prepare.packetId,
        rejectCode: 'T00',
        rejectMessage: 'no outgoing connector config for peer'
      });
      return;
    }

    this._logger.debug(
      `POST prepare → ${outgoing.endpoint} (peer ${prepare.peerId}, packet ${prepare.packetId})`
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this._acceptTimeoutMs);

    try {
      const res = await fetch(outgoing.endpoint, {
        method: 'POST',
        headers: {
          'content-type': ILP_CONTENT_TYPE,
          accept: ILP_CONTENT_TYPE,
          authorization: `Bearer ${outgoing.authToken}`,
          [REQUEST_ID_HEADER]: prepare.packetId,
          [CALLBACK_URL_HEADER]: `${this._resolvedPublicBaseUrl}${this._callbackPath}`
        },
        body: new Uint8Array(serializeWirePrepare(prepare)),
        signal: controller.signal
      });

      this._logger.debug(
        `Prepare POST peer ${prepare.peerId} packet ${prepare.packetId} → HTTP ${res.status}`
      );

      if (res.status === 202) {
        void this._outboundPrepareAcceptedHandler?.(prepare);
        return;
      }
      if (res.status >= 500) {
        throw new PeerHttpError(
          'T00',
          `peer responded with HTTP ${res.status}`
        );
      }
      throw new PeerHttpError('F00', `peer responded with HTTP ${res.status}`);
    } catch (err) {
      const { rejectCode, message } =
        err instanceof PeerHttpError
          ? { rejectCode: err.rejectCode, message: err.message }
          : {
              rejectCode: 'T01',
              message: `peer unreachable: ${(err as Error).message}`
            };

      this._logger.warn(
        `Outbound prepare to peer ${prepare.peerId} (packet ${prepare.packetId}) failed: ${message}`
      );
      await this._deliverResponse({
        kind: 'REJECT',
        packetId: prepare.packetId,
        rejectCode,
        rejectMessage: message
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async sendFulfill(
    fulfill: WireFulfill,
    peerId: string,
    callbackDeadline: string
  ): Promise<void> {
    await this._sendInboundReply(peerId, fulfill, callbackDeadline);
  }

  async sendReject(
    reject: WireReject,
    peerId: string,
    callbackDeadline: string
  ): Promise<void> {
    await this._sendInboundReply(peerId, reject, callbackDeadline);
  }

  private async _sendInboundReply(
    peerId: string,
    response: WireResponse,
    callbackDeadline: string
  ): Promise<void> {
    const outgoing = this._directory.getOutgoing(peerId);
    if (!outgoing) {
      this._logger.warn(
        `Peer ${peerId} has no outgoing config; dropping callback for packet ${response.packetId}`
      );
      return;
    }

    await this._sendCallback(
      response.packetId,
      response,
      outgoing.callbackEndpoint,
      callbackDeadline,
      outgoing.authToken
    );
  }

  private async _sendCallback(
    packetId: string,
    response: WireResponse,
    callbackUrl: string,
    callbackDeadline: string,
    authToken: string
  ): Promise<void> {
    const deadline = Date.parse(callbackDeadline);
    while (true) {
      try {
        const res = await fetch(callbackUrl, {
          method: 'POST',
          headers: {
            'content-type': ILP_CONTENT_TYPE,
            authorization: `Bearer ${authToken}`,
            [REQUEST_ID_HEADER]: packetId
          },
          body: new Uint8Array(serializeWireResponse(response))
        });

        if (res.ok || (res.status >= 400 && res.status < 500)) {
          return;
        }
        throw new Error(`callback POST got HTTP ${res.status}`);
      } catch (err) {
        if (!Number.isFinite(deadline) || Date.now() >= deadline) {
          this._logger.warn(
            `Giving up delivering callback for packet ${packetId}: callback deadline passed. Last error: ${(err as Error).message}`
          );
          return;
        }
        this._logger.warn(
          `Callback delivery for packet ${packetId} failed, retrying: ${(err as Error).message}`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, this._callbackRetryDelayMs)
        );
      }
    }
  }

  private async _deliverResponse(response: WireResponse): Promise<void> {
    await this._responseHandler?.(response);
  }

  private _handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    if (req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    if (req.url === this._path) {
      this._handleIncomingPrepare(req, res);
      return;
    }
    if (req.url === this._callbackPath) {
      this._handleIncomingCallback(req, res);
      return;
    }
    res.writeHead(404).end();
  }

  private _handleIncomingPrepare(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    const peerId = this._authenticate(req);
    if (!peerId) {
      res.writeHead(401).end();
      return;
    }
    if (!this._directory.isActive(peerId)) {
      res.writeHead(403).end();
      return;
    }

    const requestId = req.headers[REQUEST_ID_HEADER];
    if (typeof requestId !== 'string') {
      res.writeHead(400).end();
      return;
    }

    this._readBody(req, (body) => {
      let prepare: WirePrepare;
      try {
        prepare = deserializeWirePrepare(body, peerId, requestId);
      } catch {
        res.writeHead(400).end();
        return;
      }

      res.writeHead(202).end();
      void this._inboundPrepareHandler?.(prepare);
    });
  }

  private _handleIncomingCallback(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    const peerId = this._authenticate(req);
    if (!peerId) {
      res.writeHead(401).end();
      return;
    }

    const requestId = req.headers[REQUEST_ID_HEADER];
    if (typeof requestId !== 'string') {
      res.writeHead(400).end();
      return;
    }

    this._readBody(req, (body) => {
      let response: WireResponse;
      try {
        response = deserializeWireResponse(body, requestId);
      } catch {
        res.writeHead(400).end();
        return;
      }

      res.writeHead(200).end();
      void this._deliverResponse(response);
    });
  }

  private _authenticate(req: http.IncomingMessage): string | undefined {
    const token = this._extractBearerToken(req.headers.authorization);
    return token
      ? this._directory.resolvePeerIdByIncomingToken(token)
      : undefined;
  }

  private _readBody(
    req: http.IncomingMessage,
    onComplete: (body: Buffer) => void
  ): void {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on('end', () => onComplete(Buffer.concat(chunks)));
  }

  private _extractBearerToken(header: string = ''): string | undefined {
    const prefix = 'bearer ';
    if (header.slice(0, prefix.length).toLowerCase() !== prefix) {
      return undefined;
    }
    const token = header.slice(prefix.length).trim();
    return token.length > 0 ? token : undefined;
  }
}

class PeerHttpError extends Error {
  constructor(
    public readonly rejectCode: string,
    message: string
  ) {
    super(message);
  }
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') {
    end--;
  }
  return value.slice(0, end);
}

function serializeWirePrepare(prepare: WirePrepare): Buffer {
  return serializeIlpPrepare({
    amount: prepare.amount,
    executionCondition: Buffer.from(prepare.executionCondition, 'base64'),
    expiresAt: new Date(prepare.expiresAt),
    destination: prepare.destinationIlpAddress,
    data: optionalDataBuffer(prepare.data)
  });
}

function deserializeWirePrepare(
  body: Buffer,
  peerId: string,
  packetId: string
): WirePrepare {
  const parsed = deserializeIlpPrepare(body);
  return {
    peerId,
    packetId,
    destinationIlpAddress: parsed.destination,
    amount: parsed.amount,
    expiresAt: parsed.expiresAt.toISOString(),
    executionCondition: parsed.executionCondition.toString('base64'),
    data: optionalDataBase64(parsed.data)
  };
}

function serializeWireResponse(response: WireResponse): Buffer {
  if (response.kind === 'FULFILL') {
    return serializeIlpFulfill({
      fulfillment: Buffer.from(response.fulfillment, 'base64'),
      data: optionalDataBuffer(response.data)
    });
  }
  return serializeIlpReject({
    code: response.rejectCode,
    triggeredBy: response.triggeredBy ?? '',
    message: response.rejectMessage ?? '',
    data: optionalDataBuffer(response.data)
  });
}

function deserializeWireResponse(body: Buffer, packetId: string): WireResponse {
  const reply = deserializeIlpReply(body);
  if (isFulfill(reply)) {
    return {
      kind: 'FULFILL',
      packetId,
      fulfillment: reply.fulfillment.toString('base64'),
      data: optionalDataBase64(reply.data)
    };
  }
  return {
    kind: 'REJECT',
    packetId,
    rejectCode: reply.code,
    rejectMessage: reply.message || undefined,
    triggeredBy: reply.triggeredBy || undefined,
    data: optionalDataBase64(reply.data)
  };
}

function optionalDataBuffer(data?: string): Buffer {
  return data ? Buffer.from(data, 'base64') : Buffer.alloc(0);
}

function optionalDataBase64(data: Buffer): string | undefined {
  return data.length > 0 ? data.toString('base64') : undefined;
}
