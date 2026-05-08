# Liquidity Specific API for PAL

## High level API

Semantics mimic high performance requests, not available via gRPC or the client, only via event driven integration layer

- Check balance and reserve transfer
- Confirm transfer
- Reject transfer
- Reserve transfer (ignores balance)

## Low level API

For admin and other non-high perf requests, available via gRPC or the client

- Create Ledger (ledger is per asset code/id)
- Create Account on Ledger (account configs TBD)
- Post Transfer between same ledger accounts
- ?Queries? maybe on the read side from the projections

## Liquidity use cases

### Low level API

| Command                | Description                                                | Resulting State Event               | Domain/Integration Event(s)  |
| ---------------------- | ---------------------------------------------------------- | ----------------------------------- | ---------------------------- |
| CreateLedgerCmd        | Create a new ledger for a given asset code                 | LedgerCreatedStateEvent             | (none)                       |
| CreateLedgerAccountCmd | Create a new account on a ledger                           | LedgerAccountCreatedStateEvent      | LedgerAccountCreatedEvent    |
| PostTransactionCmd     | Post a transaction between two accounts on the same ledger | LedgerTransactionRecordedStateEvent | LedgerTransactionPostedEvent |

### High level API

| Command                           | Description                                                                                        | Resulting State Event                  | Domain/Integration Event(s) |
| --------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------- |
| CheckBalanceAndReserveTransferCmd | Check for available liquidity before reserving the transfer (payer clearing to suspense)           | LedgerTransactionRecordedStateEvent    | LedgerTransferReservedEvent |
| ReserveTransferCmd                | Reserve transfer without checking for available liquidity                                          | LedgerTransactionRecordedStateEvent    | LedgerTransferReservedEvent |
| CommitTransferCmd                 | Commit a reserved transfer (reverse suspention and transfer from payer clearing to payee clearing) | LedgerTransactionRecordedStateEvent x2 | TransferCommittedEvent      |
| RejectTransferCmd                 | Reject a reserved transfer (reverse suspention)                                                    | LedgerTransactionRecordedStateEvent    | TransferRejectedEvent       |

# Domain event VS Integration event logic

Today these Domain events are used as Integration events as well. We don't have the need to separate them at the moment. However, in the future, we may want to introduce a separate integration event stream for external BCs to consume, while keeping the domain events for internal purposes.

The trigger for this decision should be if we have the need map internal domain events to remove private data for the externally consumed events.
