import { IMessage } from 'common-types-lib';
import {
  ContinueGrantCmd,
  CreateGrantCmd,
  InteractionApprovedCommand,
  InteractionDeniedCommand
} from '../commands';
import { DuplicateGrantError, GrantNotFoundError } from './errors';
import {
  GrantCreatedEvent,
  GrantCreateFailedEvent,
  GrantContinuedEvent,
  GrantContinueFailedEvent,
  GrantInteractionChoiceHandledEvent,
  GrantInteractionChoiceFailedEvent
} from './events';
import {
  AccessAction,
  AccessType,
  GrantFinalization,
  IAccessItem,
  IAccessLimit,
  IFinishMethod,
  IGrant,
  InteractionChoice,
  InteractionState,
  IStartMethod,
  ISubjectId
} from './interfaces';
import { GrantEntity } from './entity';

export interface IGrantService {
  fetchByIds(grantIds: string[]): Promise<IGrant[]>;
}

export class GrantAggregate {
  private grantMap = new Map<string, GrantEntity>();

  constructor(private _grantService: IGrantService) {}

  async handleBatch(cmds: IMessage[]): Promise<{ events: IMessage[] }> {
    const outputEvents: IMessage[] = [];

    const grantIdSet = new Set<string>();
    for (const cmd of cmds) {
      if (cmd.msgName === CreateGrantCmd.name) {
        const payload = (cmd as CreateGrantCmd).payload;
        grantIdSet.add(payload.id);
      } else if (cmd.msgName === ContinueGrantCmd.name) {
        const payload = (cmd as ContinueGrantCmd).payload;
        grantIdSet.add(payload.id);
      } else if (
        (cmd.msgName = InteractionApprovedCommand.name) ||
        (cmd.msgName = InteractionDeniedCommand.name)
      ) {
        const payload = (
          cmd as InteractionApprovedCommand | InteractionDeniedCommand
        ).payload;
        grantIdSet.add(payload.id);
      }

      const grants = await this._grantService.fetchByIds([...grantIdSet]);

      for (const grant of grants) {
        this.grantMap.set(grant.id, GrantEntity.fromObject(grant));
      }

      for (const cmd of cmds) {
        let event: IMessage;
        if (cmd.msgName == CreateGrantCmd.name) {
          event = this.handleCreateGrantCommand(cmd as CreateGrantCmd);
        } else if (cmd.msgName === ContinueGrantCmd.name) {
          event = this.handleContinueGrantCommand(cmd as ContinueGrantCmd);
        } else if (cmd.msgName === InteractionApprovedCommand.name) {
          event = this.handleInteractionApprovedCommand(
            cmd as InteractionApprovedCommand
          );
        } else if (cmd.msgName === InteractionDeniedCommand.name) {
          event = this.handleInteractionDeniedCommand(
            cmd as InteractionDeniedCommand
          );
        } else {
          throw new Error('Unexpected command');
        }

        outputEvents.push(event);
      }
    }
    return { events: outputEvents };
  }

  private handleCreateGrantCommand(cmd: CreateGrantCmd) {
    try {
      const { id } = cmd.payload;
      if (this.grantMap.has(id)) {
        throw new DuplicateGrantError(`Grant with id ${id} already exists`);
      }

      const accessItems: IAccessItem[] | undefined = cmd.payload.access?.map(
        (access) => {
          return {
            ...access,
            type: access.type as AccessType,
            actions: access.actions as AccessAction[],
            limits: access.limits as IAccessLimit
          };
        }
      );

      const entity = GrantEntity.create({
        ...cmd.payload,
        startMethods: cmd.payload.interact?.start as IStartMethod[],
        finishMethod: cmd.payload.interact?.finish?.method as IFinishMethod,
        subjectIds: cmd.payload.subjectIds as ISubjectId[],
        accesses: accessItems
      });

      this.grantMap.set(id, entity);

      return new GrantCreatedEvent({
        id
      });
    } catch (err) {
      return new GrantCreateFailedEvent({
        grantId: cmd.payload.id,
        errorName: (err as Error).name,
        message: (err as Error).message
      });
    }
  }

  private handleContinueGrantCommand(cmd: ContinueGrantCmd) {
    const { id, continueId, continueToken, interactRef } = cmd.payload;
    try {
      const grant = this.grantMap.get(id);
      if (!grant) {
        throw new GrantNotFoundError(`Grant ${id} not found`);
      }

      grant.continue(continueToken, continueId, interactRef);

      this.grantMap.set(id, grant);
      return new GrantContinuedEvent({
        id,
        result: grant.finalizationReason as GrantFinalization
      });
    } catch (err) {
      return new GrantContinueFailedEvent({
        grantId: cmd.payload.id,
        errorName: (err as Error).name,
        message: (err as Error).message
      });
    }
  }

  private handleInteractionChoice(
    id: string,
    choice: InteractionChoice,
    interactId: string
  ) {
    try {
      const grant = this.grantMap.get(id);
      if (!grant) {
        throw new GrantNotFoundError(`Grant ${id} not found`);
      }

      grant.handleInteractionChoice(choice);
      this.grantMap.set(id, grant);

      return new GrantInteractionChoiceHandledEvent({
        id,
        interactId
      });
    } catch (error) {
      return new GrantInteractionChoiceFailedEvent({
        grantId: id,
        errName: (error as Error).name,
        message: (error as Error).message
      });
    }
  }

  private handleInteractionApprovedCommand(cmd: InteractionApprovedCommand) {
    const { id, interactId } = cmd.payload;

    return this.handleInteractionChoice(
      id,
      InteractionState.APPROVED,
      interactId
    );
  }

  private handleInteractionDeniedCommand(cmd: InteractionDeniedCommand) {
    const { id, interactId } = cmd.payload;

    return this.handleInteractionChoice(
      id,
      InteractionState.DENIED,
      interactId
    );
  }
}
