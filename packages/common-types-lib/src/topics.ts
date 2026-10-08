// public domain events
export enum DomainEventTopics {
  'PaymentEvents' = 'payment-domain-events',
  'AuthEvents' = 'auth-domain-events',
  'LedgerEvents' = 'ledger-domain-events',
  'AssetEvents' = 'asset-domain-events',
  'PeerEvents' = 'peer-domain-events',
  'FxRateEvents' = 'fxrate-domain-events',
  'WalletAddressEvents' = 'wallet-address-domain-events',
  'IlpEvents' = 'ilp-domain-events'
}

// TODO pedro: not sure we should keep commands, state events and snapshots in the common types lib,
// maybe they should be in the BC types libs?
export enum CommandTopics {
  'PaymentCommands' = 'payment-commands',
  'AuthCommands' = 'auth-commands',
  'LedgerCommands' = 'ledger-commands',
  'IlpCommands' = 'ilp-commands',
  'IlpConnectorCommands' = 'ilp-connector-commands',
  'NotificationCommands' = 'notification-commands'
}

// for private event-sourcing events
export enum StateEventTopics {
  'LedgerStateEvents' = 'ledger-state-events'
}

// for private event-sourcing snapshot events
export enum SnapshotEventTopics {
  'LedgerSnapshotEvents' = 'ledger-snapshot-events'
}

// For private timer related events, like check for expired transfers
// or if a snapshot needed.
export enum TimerEventTopics {
  'LedgerTimerEvents' = 'ledger-timer-events'
}
