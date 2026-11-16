# Remote Outgoing Payment - Receiving

Funds are reserved, then the fulfill is sent, then the reservation is committed. The inbound payment moves `VALIDATED` → `ACCEPTED` → `FULFILLED` → `FINALIZED`, or to `FAILED` from any step before the fulfill.

```mermaid
sequenceDiagram
	autonumber


    participant Peer as Peer / ILP Network
    participant ILPBC as ILP BC
    participant PBC as Payments BC
    participant PAL as PAL BC
    participant NBC as Notifications BC
    participant AAPI as Admin API
    participant ASE as ASE

    Peer ->> ILPBC: Prepare packet
    ILPBC ->> ILPBC: Decode & determine peer
    ILPBC ->> ILPBC: Publish ILPPaymentReceivedEvent

    PBC -->> ILPBC: Read ILPPaymentReceivedEvent
    PBC ->> PBC: Fetch payment intent
    PBC ->> PBC: Validate & persist payment (VALIDATED)<br>with a new ledger transfer id
    PBC ->> PBC: Publish InboundPaymentValidatedEvent

    alt Validation failed
    PBC ->> PBC: Publish InboundPaymentValidationFailedEvent
    ILPBC -->> PBC: Read InboundPaymentValidationFailedEvent
    ILPBC ->> Peer: Reject packet
    end

    PAL -->> PBC: Read InboundPaymentValidatedEvent
    PAL ->> PAL: Reserve funds under the ledger transfer id
    PAL ->> PAL: Publish LedgerIncomingTransferReservedEvent

    alt Reserve failed
    PAL ->> PAL: Publish LedgerIncomingTransferInsufficientFundsErrorEvent/<br>LedgerIncomingTransferReserveFailedEvent
    PBC -->> PAL: Read reserve failure
    PBC ->> PBC: Mark payment as failed
    PBC ->> PBC: Publish InboundPaymentReserveFailedEvent
    ILPBC -->> PBC: Read InboundPaymentReserveFailedEvent
    ILPBC ->> Peer: Reject packet
    end

    PBC -->> PAL: Read LedgerIncomingTransferReservedEvent
    Note over PBC, ASE: Accepted automatically for now. Design: mark pending acceptance,<br>notify the ASE via Notifications, ASE accepts through the Admin API.
    PBC ->> PBC: Mark payment as accepted (ACCEPTED)
    PBC ->> PBC: Publish InboundPaymentAcceptedEvent

    alt Intent no longer CREATED, or packet expires within 1s
    PBC ->> PBC: Mark payment as failed
    PBC ->> PBC: Publish InboundPaymentAcceptFailedEvent
    par
    ILPBC -->> PBC: Read InboundPaymentAcceptFailedEvent
    ILPBC ->> Peer: Reject packet
    and
    PAL -->> PBC: Read InboundPaymentAcceptFailedEvent
    PAL ->> PAL: Void reservation
    end
    end

    ILPBC -->> PBC: Read InboundPaymentAcceptedEvent
    ILPBC ->> ILPBC: Create fulfillment
    ILPBC ->> Peer: Return fulfillment

    alt Fulfilled payment
    ILPBC ->> ILPBC: Publish ILPPaymentFulfillmentSentEvent
    PBC -->> ILPBC: Read ILPPaymentFulfillmentSentEvent
    PBC ->> PBC: Mark payment as fulfilled (FULFILLED)
    PBC ->> PBC: Publish InboundPaymentFulfilledEvent
    PAL -->> PBC: Read InboundPaymentFulfilledEvent
    PAL ->> PAL: Commit reservation
    PAL ->> PAL: Publish LedgerIncomingTransferCommittedEvent
    PBC -->> PAL: Read LedgerIncomingTransferCommittedEvent
    PBC ->> PBC: Mark payment as finalized (FINALIZED)<br>& credit the payment intent
    PBC ->> PBC: Publish InboundPaymentFinalizedEvent
    NBC -->> PBC: Read InboundPaymentFinalizedEvent
    NBC ->> ASE: Notify of finalized inbound payment
    ASE ->> ASE: Credit user

    else Could not fulfill payment
    ILPBC ->> ILPBC: Publish ILPPaymentFulfillmentFailedEvent
    PBC -->> ILPBC: Read ILPPaymentFulfillmentFailedEvent
    PBC ->> PBC: Mark payment as failed
    PBC ->> PBC: Publish InboundPaymentFulfillFailedEvent
    par
    PAL -->> PBC: Read InboundPaymentFulfillFailedEvent
    PAL ->> PAL: Void reservation
    and
    NBC -->> PBC: Read InboundPaymentFulfillFailedEvent
    NBC ->> ASE: Notify of failed inbound payment
    end
    end
```

- Payments creates the ledger transfer id at validation, so a payment that fails while its reservation is in flight can still be voided. PAL ignores a reserve for a transfer id it already holds.
- PAL commands are keyed by asset code and payment events by payment intent, so PAL always handles the reserve before a void for the same payment. A reserve that lands after the payment failed is voided; the late accept is ignored.
- Commands for a step that already happened do nothing.
- If the commit fails after the fulfill went out, Payments logs an error for reconciliation and the payment stays `FULFILLED`. Nothing reconciles it automatically yet.
- Notifications reacting to inbound payment events is not implemented yet.

## Expiry

The inbound payment stores the packet's `expiresAt`. Validate and Accept refuse a payment whose packet expires within 1s, the time the fulfill needs to reach the sender. The check below expires payments still `VALIDATED` after their `expiresAt`, for example when PAL never answered.

```mermaid
sequenceDiagram
	autonumber

    participant PEH as Payments event handler
    participant PBC as Payments BC
    participant PAL as PAL BC
    participant ILPBC as ILP BC
    participant Peer as Peer / ILP Network

    loop Every second, on one instance
    PEH ->> PEH: Tick (fixed key, so one instance consumes it)
    PEH ->> PEH: Find VALIDATED inbound payments past expiresAt
    PEH ->> PBC: ExpireInboundPaymentCmd (keyed by payment intent)
    end

    PBC ->> PBC: Handle ExpireInboundPaymentCmd<br>Mark inbound payment as failed (if still VALIDATED)
    PBC ->> PBC: Publish InboundPaymentExpiredEvent
    par
    ILPBC -->> PBC: Read InboundPaymentExpiredEvent
    ILPBC ->> Peer: Reject packet
    and
    PAL -->> PBC: Read InboundPaymentExpiredEvent
    PAL ->> PAL: Void reservation
    end
```

- `ACCEPTED` payments are not expired: ILP may be sending the fulfill at that moment, and voiding it would lose funds. ILP refusing to fulfill a packet past its expiry, and reporting a failed fulfill, covers that case (#421).
