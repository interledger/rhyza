'use strict';

import {
  ConnectionAssetDetailsFrame,
  ConnectionNewAddressFrame,
  Frame,
  IlpPacketType,
  Packet,
  StreamMoneyFrame
} from 'ilp-protocol-stream/dist/src/packet.js';
import {
  ENCRYPTION_KEY_STRING,
  FULFILLMENT_GENERATION_STRING,
  decryptStreamData,
  encryptStreamData,
  hmacSha256,
  sha256
} from './decode.js';

/** Client-initiated stream id (odd). Single stream for the minimal sender. */
const DEFAULT_STREAM_ID = 1;
/** All ILP prepare amount attributed to that one stream. */
const DEFAULT_STREAM_SHARES = 1;
const DEFAULT_SEQUENCE = 1;

export interface StreamEncodeInput {
  sharedSecret: Buffer;
  /**
   * STREAM `prepareAmount`: the minimum the receiver must see arrive before it
   * may fulfill, expressed in the units the packet arrives in. A receiver
   * answers `F04` when less arrives, so this is a floor, not the sent amount.
   * Use `'0'` on unfulfillable probes, which assert no minimum.
   */
  minDestinationAmount: string;
  sequence?: number;
}

export interface StreamEncodeResult {
  /** Encrypted STREAM packet bytes for the ILP Prepare `data` field. */
  data: Buffer;
  executionCondition: Buffer;
  fulfillment: Buffer;
}

/**
 * Minimal fulfillable STREAM encode: one stream, one StreamMoney frame, no
 * flow-control frames. Condition = SHA-256(HMAC(fulfillmentKey, data)).
 *
 * Every v2 packet opens its own connection, so each one carries
 * ConnectionNewAddress. Senders with no address of their own send it empty;
 * it is what prompts the receiver to reply with its asset details, which the
 * amount in the reply is meaningless without.
 */
export function encodeOutgoingStreamPrepare(
  input: StreamEncodeInput
): StreamEncodeResult {
  const encryptionKey = hmacSha256(input.sharedSecret, ENCRYPTION_KEY_STRING);
  const streamPacket = new Packet(
    input.sequence ?? DEFAULT_SEQUENCE,
    IlpPacketType.Prepare,
    input.minDestinationAmount,
    [
      new ConnectionNewAddressFrame(''),
      new StreamMoneyFrame(DEFAULT_STREAM_ID, DEFAULT_STREAM_SHARES)
    ]
  );
  const data = encryptStreamData(encryptionKey, streamPacket._serialize());

  const fulfillmentKey = hmacSha256(
    input.sharedSecret,
    FULFILLMENT_GENERATION_STRING
  );
  const fulfillment = hmacSha256(fulfillmentKey, data);
  const executionCondition = sha256(fulfillment);

  return { data, executionCondition, fulfillment };
}

export interface StreamQuoteReplyInput {
  sharedSecret: Buffer;
  // Encrypted STREAM prepare `data` from the inbound/outbound probe
  prepareData: Buffer;
  // Destination amount to put in STREAM `prepareAmount`
  prepareAmount: string;
  // Our asset, so the sender can interpret `prepareAmount`
  assetCode?: string;
  assetScale?: number;
}

/**
 * Encrypted STREAM reject whose `prepareAmount` is the destination amount.
 *
 * Returns undefined when the probe data is not a STREAM packet under this
 * secret; callers answer with a plain reject rather than propagating a throw
 * out of a command handler and poisoning the Kafka batch.
 */
export function encodeStreamQuoteReply(
  input: StreamQuoteReplyInput
): Buffer | undefined {
  const encryptionKey = hmacSha256(input.sharedSecret, ENCRYPTION_KEY_STRING);

  let request: Packet;
  try {
    request = Packet._deserializeUnencrypted(
      decryptStreamData(encryptionKey, input.prepareData)
    );
  } catch {
    return undefined;
  }

  // Without the asset the sender cannot tell what unit prepareAmount is in.
  const frames: Frame[] =
    input.assetCode !== undefined && input.assetScale !== undefined
      ? [new ConnectionAssetDetailsFrame(input.assetCode, input.assetScale)]
      : [];

  const reply = new Packet(
    request.sequence,
    IlpPacketType.Reject,
    input.prepareAmount,
    frames
  );
  return encryptStreamData(encryptionKey, reply._serialize());
}
