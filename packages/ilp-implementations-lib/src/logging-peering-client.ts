import { ILogger } from 'common-types-lib';
import { IPeeringClient, PacketDispatch } from 'ilp-domain-lib';

// An IPeeringClient that only logs. Useful for local runs and tests
// where no connector is attached.
export class LoggingPeeringClient implements IPeeringClient {
  constructor(private readonly _logger: ILogger) {}

  async dispatch(input: PacketDispatch): Promise<void> {
    this._logger.info(
      `[LoggingPeeringClient] would dispatch ${input.type} prepare ` +
        `packet=${input.packetId} peer=${input.peerId} ` +
        `dest=${input.destinationIlpAddress}`
    );
  }
}
