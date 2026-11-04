'use strict';

import { FrameType, Packet } from 'ilp-protocol-stream/dist/src/packet.js';
import {
  decrypt,
  encrypt,
  hmac,
  sha256
} from '@interledger/stream-receiver/dist/src/utils.js';

// Same key-derivation labels StreamServer uses internally.
export const FULFILLMENT_GENERATION_STRING = Buffer.from(
  'ilp_stream_fulfillment'
);
export const ENCRYPTION_KEY_STRING = Buffer.from('ilp_stream_encryption');

export {
  hmac as hmacSha256,
  sha256,
  encrypt as encryptStreamData,
  decrypt as decryptStreamData
};

export interface StreamReply {
  // Amount that arrived at the receiver, in the receiver's asset.
  prepareAmount: string;
  // The receiver sent a ConnectionClose frame. The reply is a refusal, so
  // `prepareAmount` must not be read as a quote.
  connectionClosed: boolean;
  assetCode?: string;
  assetScale?: number;
}

// Decrypt a STREAM reply, or undefined when it is not ours / not a STREAM packet.
export function decodeStreamReply(
  sharedSecret: Buffer,
  data: Buffer
): StreamReply | undefined {
  let packet: Packet;
  try {
    const encryptionKey = hmac(sharedSecret, ENCRYPTION_KEY_STRING);
    packet = Packet._deserializeUnencrypted(decrypt(encryptionKey, data));
  } catch {
    return undefined;
  }

  const assetDetails = packet.frames.find(
    (frame) => frame.type === FrameType.ConnectionAssetDetails
  ) as { sourceAssetCode: string; sourceAssetScale: number } | undefined;

  return {
    prepareAmount: packet.prepareAmount.toString(),
    connectionClosed: packet.frames.some(
      (frame) => frame.type === FrameType.ConnectionClose
    ),
    assetCode: assetDetails?.sourceAssetCode,
    assetScale: assetDetails?.sourceAssetScale
  };
}

// Decrypt STREAM reply/prepare `data` and read `prepareAmount`, or undefined
export function decodeStreamPrepareAmount(
  sharedSecret: Buffer,
  data: Buffer
): string | undefined {
  return decodeStreamReply(sharedSecret, data)?.prepareAmount;
}
