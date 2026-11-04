# Remote Payment - Sending

```mermaid
sequenceDiagram
	autonumber

    participant AAPI as Admin API
    participant PBC as Payments BC
    participant PAL as PAL BC
    participant ILPBC as ILP BC
    participant Peer as Peer / ILP Network

    AAPI ->> PBC: Approve payment send
    PBC ->> PBC: Determine remote payment needed
    PBC ->> PBC: Mark payment as processing

    PBC ->> PBC: Publish remote payment send approved event

    %% PBC ->> AAPI: Return payment status

    PAL -->> PBC: Read remote payment send approved event
    PAL ->> PAL: Resolve peer & reserve funds

    alt Not Enough liquidity
    PAL ->> PAL: Publish peer liquidity insufficient funds event<br>LedgerOutgoingTransferInsufficientFundsErrorEvent
   PBC -->> PAL: Read LedgerOutgoingTransferInsufficientFundsErrorEvent
    end
    PAL ->> PAL: Publish peer liquidity transfer reserved event<br>LedgerOutgoingTransferReservedEvent
    PBC -->> PAL: Read LedgerOutgoingTransferReservedEvent
    PBC ->> PBC: Payment prepared event
    ILPBC ->> PBC: Read payment prepared event

    ILPBC ->> ILPBC: Store packet correlation & expiry
    ILPBC ->> Peer: Send prepare packet
    Peer -->> ILPBC: Receive fulfill/reject packet
    ILPBC ->> ILPBC: Publish payment confirmed/rejected event

    PBC -->> ILPBC: Read remote payment confirmed/rejected event
    PBC ->> PBC: Mark payment as confirmed/rejected
    PBC ->> PBC: Publish remote payment confirmed/rejected event
    PAL -->> PBC: Read remote payment confirmed/rejected event
    PAL ->> PAL: Commit/reject liquidity transfer
    PAL ->> PAL: Publish LedgerOutgoingTransferRejectedEvent
    PBC -->> PAL: Read LedgerOutgoingTransferCommittedEvent/<br>LedgerOutgoingTransferRejectedEvent
    PBC ->> PBC: Mark payment complete/failed
    PBC -->> PBC: Publish payment completed/failed event
```

# Expiry

When the payment is prepared, Payments sets the packet deadline to `min(now + 30s, intent expiry)` and sends it on the payment prepared event. The payment itself expires a grace period (5s) after the packet deadline, so a fulfill that reaches the connector in time also reaches Payments before the payment expires.

```mermaid
sequenceDiagram
	autonumber

    participant PEH as Payments event handler
    participant PBC as Payments BC
    participant PAL as PAL BC
    participant ILPBC as ILP BC

    loop Every second, on one instance
    PEH ->> PEH: Tick (fixed key, so one instance consumes it)
    PEH ->> PEH: Find SENDING payments past expiresAt
    PEH ->> PBC: ExpirePaymentCmd (keyed by payment intent)
    end

    PBC ->> PBC: Mark payment as expired (SENDING only, otherwise no-op)
    PBC ->> PBC: Publish PaymentExpiredEvent
    PAL -->> PBC: Read PaymentExpiredEvent
    PAL ->> PAL: Reject (void) liquidity transfer
    PAL ->> PAL: Publish LedgerOutgoingTransferRejectedEvent
    PBC -->> PAL: Read LedgerOutgoingTransferRejectedEvent
    PBC ->> PBC: Mark payment failed (reason: expired)
    ILPBC -->> PBC: Read PaymentExpiredEvent
    ILPBC ->> ILPBC: Expire the PENDING packet
```

- `EXPIRED` waits for PAL the way `REJECTED` does, then becomes `FAILED`.
- A late ILP failure for an expired payment is ignored.
- A late fulfill for an expired payment is logged as an error that needs reconciliation. The grace period makes this rare but cannot rule it out, and nothing reconciles it automatically yet.
- PAL releasing the reservation (#365) and ILP expiring the packet (#366) are separate changes.
- The same check expires `CREATED` payment intents past their `expiresAt`.

# Notes

- Should we mark the outgoing remote payment as completed/failed _after_ the PAL BC finalizes or voids the liquidity transfer? Or should we be optimisic? What is a "pending" transfer in the first place?
