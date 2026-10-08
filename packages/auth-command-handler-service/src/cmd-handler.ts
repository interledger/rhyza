import {
  CommandTopics,
  ILogger,
  IMessage,
  IMessageConsumer,
  IMessageProducer
} from 'common-types-lib';
import {
  CreateGrantCmd,
  ContinueGrantCmd,
  RevokeGrantCmd,
  AdminRevokeGrantCmd,
  IntrospectTokenCmd,
  RotateTokenCmd,
  RevokeTokenCmd,
  AcceptInteractionCmd,
  RejectInteractionCmd,
  GrantAggregate,
  StartInteractionCmd,
  FinishInteractionCmd
} from 'auth-domain-lib';

export class AuthCommandHandler {
  private _msgConsumer: IMessageConsumer;
  private _msgProducer: IMessageProducer;
  private _grantAggregate: GrantAggregate;
  private _logger: ILogger;

  constructor(
    msgConsumer: IMessageConsumer,
    msgProducer: IMessageProducer,
    grantAggregate: GrantAggregate,
    logger: ILogger
  ) {
    this._msgConsumer = msgConsumer;
    this._msgProducer = msgProducer;
    this._grantAggregate = grantAggregate;
    this._logger = logger;
  }

  async start(): Promise<void> {
    this._msgConsumer.setTopics([CommandTopics.AuthCommands]);
    this._msgConsumer.setBatchCallbackFn(this._handleBatch.bind(this));
    await this._msgConsumer.connect();
    await this._msgConsumer.startAndWaitForRebalance();
  }

  async stop(): Promise<void> {
    await this._msgConsumer.stop();
    await this._msgConsumer.disconnect(true);
  }

  private async _handleBatch(messages: IMessage[]): Promise<void> {
    const commandMessages: IMessage[] = [];
    const unhandled: IMessage[] = [];

    for (const msg of messages) {
      switch (msg.msgName) {
        case CreateGrantCmd.name:
        case ContinueGrantCmd.name:
        case RevokeGrantCmd.name:
        case AdminRevokeGrantCmd.name:
        case IntrospectTokenCmd.name:
        case RotateTokenCmd.name:
        case RevokeTokenCmd.name:
        case StartInteractionCmd.name:
        case AcceptInteractionCmd.name:
        case RejectInteractionCmd.name:
        case FinishInteractionCmd.name:
          commandMessages.push(msg);
          break;
        default:
          unhandled.push(msg);
          break;
      }
    }

    if (unhandled.length > 0) {
      this._logger.warn(
        `Unhandled command types: ${[...new Set(unhandled.map((m) => m.msgName))].join(', ')}`
      );
    }

    const eventsToPublish: IMessage[] = [];

    if (commandMessages.length > 0) {
      const { events } =
        await this._grantAggregate.handleBatch(commandMessages);
      eventsToPublish.push(...events);

      await this._grantAggregate.flush();
    }

    if (eventsToPublish.length > 0) {
      await this._msgProducer.send(eventsToPublish);
    }
  }
}
