# Architecture Decision Records

This folder contains Architecture Decision Records (ADRs) for Rhyza.

Whenever we make a particular technical decision that have impact on general system structure, long-term maintainability or or external interfaces (in our case, Open Payments APIs in particular), we will track it here so it's easy to understand the "why" behind what we did.
ADRs contain the context that forced the decision, what was chosen, what were some of the alternatives, and what tradeoffs were accepted.

Guidelines:

- A single ADR outlines a single decision, numbered `NNN-short-title.md`, starting from the [template](#template) below.
- Numbers are never reused.
- An accepted ADR is not rewritten. If the decision changes, add a new ADR and set the old one's status to `Superseded by NNN`.
- An ADR is `Accepted` once the decision is made and work on it has started. Use `Proposed` only while it is still under discussion.

## Decisions

| #   | Title                                                                                                     | Status   |
| --- | --------------------------------------------------------------------------------------------------------- | -------- |
| 001 | [Kafka for commands and events between and within bounded contexts](001-kafka-for-commands-and-events.md) | Accepted |
| 002 | [MongoDB as the default database](002-mongodb-as-default-database.md)                                     | Accepted |
| 003 | [gRPC for internal APIs](003-grpc-for-internal-apis.md)                                                   | Accepted |
| 004 | [Store all ledger amounts at a fixed asset scale of 20](004-fixed-ledger-asset-scale.md)                  | Accepted |
| 005 | [A single REST Admin API](005-rest-admin-api.md)                                                          | Accepted |
| 006 | [Opaque compound ids for Open Payments resources](006-opaque-compound-ids.md)                             | Accepted |
| 007 | [Opaque pagination cursors for Open Payments list actions](007-opaque-pagination-cursors.md)              | Accepted |
| 008 | [Store grant spent amounts in the Auth BC](008-grant-spent-amounts-in-auth-bc.md)                         | Accepted |

## Writing a new ADR

- Copy the template below into a new file: `NNN-short-title.md`
- Fill in each section, keeping it concise
- Add a row to the table above

## Template

```markdown
# NNN: Title

**Status:** Proposed | Accepted | Deprecated | Superseded by NNN
**Date:** YYYY-MM-DD
**Linear Issue:** RHY-XXX (if applicable)

## Context

What problem or question forced a decision, and the constraints that matter.

## Options considered

- **Option A**: short description. Rejected because ...
- **Option B**: short description.

## Decision

What we chose, stated plainly.

## Consequences

### Positive

### Negative
```
