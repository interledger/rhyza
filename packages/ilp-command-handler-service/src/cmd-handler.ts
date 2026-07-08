import {
  CommandTopics,
  ILogger,
  IMessage,
  IMessageConsumer,
  IMessageProducer
} from 'common-types-lib';
import {
  ExpirePacketCmd,
  IlpPeerAggregate,
  ProcessFulfillPacketCmd,
  ProcessRejectPacketCmd,
  StartRemotePaymentCmd,
  StartRemoteQuoteCmd
} from 'ilp-domain-lib';

const HANDLED_COMMANDS = new Set<string>([
  StartRemoteQuoteCmd.name,
  StartRemotePaymentCmd.name,
  ProcessFulfillPacketCmd.name,
  ProcessRejectPacketCmd.name,
  ExpirePacketCmd.name
]);

export class IlpCommandHandler {
  constructor(
    private readonly _msgConsumer: IMessageConsumer,
    private readonly _msgProducer: IMessageProducer,
    private readonly _ilpPeerAggregate: IlpPeerAggregate,
    private readonly _logger: ILogger
  ) {}

  async start(): Promise<void> {
    this._msgConsumer.setTopics([CommandTopics.IlpCommands]);
    this._msgConsumer.setBatchCallbackFn(this._handleBatch.bind(this));
    await this._msgConsumer.connect();
    await this._msgConsumer.startAndWaitForRebalance();
  }

  async stop(): Promise<void> {
    await this._msgConsumer.stop();
    await this._msgConsumer.disconnect(true);
  }

  private async _handleBatch(messages: IMessage[]): Promise<void> {
    const commands = messages.filter((m) => HANDLED_COMMANDS.has(m.msgName));

    const unhandled = messages.filter((m) => !HANDLED_COMMANDS.has(m.msgName));
    if (unhandled.length > 0) {
      this._logger.warn(
        `Unhandled ILP command(s): ${[...new Set(unhandled.map((m) => m.msgName))].join(', ')}`
      );
    }

    if (commands.length === 0) return;

    const { events } = await this._ilpPeerAggregate.handleBatch(commands);
    if (events.length > 0) {
      await this._msgProducer.send(events);
    }
  }
}
