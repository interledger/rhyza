export interface InFlightCorrelation {
  peerId: string;
  paymentIntentId: string;
}

export class InFlightCorrelations {
  private readonly _byPacketId = new Map<string, InFlightCorrelation>();

  add(packetId: string, correlation: InFlightCorrelation): void {
    this._byPacketId.set(packetId, correlation);
  }

  take(packetId: string): InFlightCorrelation | undefined {
    const correlation = this._byPacketId.get(packetId);
    if (correlation) {
      this._byPacketId.delete(packetId);
    }
    return correlation;
  }

  has(packetId: string): boolean {
    return this._byPacketId.has(packetId);
  }

  get size(): number {
    return this._byPacketId.size;
  }
}
