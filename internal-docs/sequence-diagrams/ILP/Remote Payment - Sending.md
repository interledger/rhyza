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
    PAL ->> PAL: Publish peer liquidity insufficient funds event
    PBC -->> PAL: Read peer liquidity insufficient funds event
    end
    PAL ->> PAL: Publish peer liquidity transfer reserved event
    PBC -->> PAL: Read peer liquidity transfer reserved event
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
    PBC -->> PAL: Read LedgerTransferCommitedEvent/<br>LedgerTransferRejectedEvent
    PBC ->> PBC: Mark payment complete/failed
    PBC -->> PBC: Publish payment completed/failed event
```

# Notes

- Should we mark the outgoing remote payment as completed/failed _after_ the PAL BC finalizes or voids the liquidity transfer? Or should we be optimisic? What is a "pending" transfer in the first place?
