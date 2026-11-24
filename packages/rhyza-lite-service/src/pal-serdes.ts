import type { IRawMessageSerializer } from 'implementations-lib';
import {
  CheckBalanceAndReserveCmdSerde,
  CommitTransferCmdSerde,
  CreateLedgerAccountForAssetCmdSerde,
  CreateLedgerAccountsForPeerCmdSerde,
  CreateLedgerCmdSerde,
  DepositToAseCmdSerde,
  DepositToPeerCmdSerde,
  LedgerAccountsCreatedStateEventSerde,
  LedgerCreatedStateEventSerde,
  LedgerSnapshotSerde,
  LedgerTransactionRecordedStateEventSerde,
  RejectTransferCmdSerde,
  ReserveTransferCmdSerde,
  WithdrawFromAseCmdSerde,
  WithdrawFromPeerCmdSerde
} from 'pal-implementations-lib';

/**
 * Registers the superset of ledger serdes the PAL services register, once each.
 * The serde factory is a process-wide singleton that throws on duplicates, so in
 * lite mode this runs once and the factory is passed into every PAL service.
 * Mirrors pal-ledger-command-handler-service/src/service.ts.
 */
export function registerPalSerdes(factory: {
  register(serde: IRawMessageSerializer): unknown;
}): void {
  // snapshots
  factory.register(new LedgerSnapshotSerde());
  // state events
  factory.register(new LedgerCreatedStateEventSerde());
  factory.register(new LedgerAccountsCreatedStateEventSerde());
  factory.register(new LedgerTransactionRecordedStateEventSerde());
  // commands
  factory.register(new CreateLedgerCmdSerde());
  factory.register(new CreateLedgerAccountForAssetCmdSerde());
  factory.register(new CreateLedgerAccountsForPeerCmdSerde());
  factory.register(new CheckBalanceAndReserveCmdSerde());
  factory.register(new ReserveTransferCmdSerde());
  factory.register(new CommitTransferCmdSerde());
  factory.register(new RejectTransferCmdSerde());
  factory.register(new DepositToAseCmdSerde());
  factory.register(new WithdrawFromAseCmdSerde());
  factory.register(new DepositToPeerCmdSerde());
  factory.register(new WithdrawFromPeerCmdSerde());
}
