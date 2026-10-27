# 004: Store all ledger amounts at a fixed asset scale of 20

**Status:** Accepted
**Date:** 2026-02

_Backfilled in October 2026. Based on the original rafiki-poc ideas from 2025._

## Context

In Rafiki, an asset is unique by `code` and `scale`, so USD at scale 2 and USD at scale 9 are separate assets, each with its own sub-ledger. They are the same currency underneath. If an integrator wanted to change a wallet address's asset scale (for example from 2 to 9 to support micropayments), it is not possible without a migration.

## Options considered

- **Keep Rafiki's model, an asset per code and scale**: rejected because it splits one currency across several ledgers, and changing a scale requires migrating balances.
- **One ledger per currency, but each account keeps its balance at its own scale** (e.g. a wallet address at scale 2 and a peer at scale 9, both in USD): rejected because every transfer between accounts at different scales would need a conversion, and changing an account's scale would still mean rewriting its balance and history.
- **A single fixed internal scale for the ledger**: chosen.

## Decision

The PAL ledger stores every amount at scale 20 (`LEDGER_INTERNAL_ASSET_SCALE`).

- Assets are unique by `code` only. `scale` is a display property of the asset, wallet address, payment or peer.
- Amounts are converted to scale 20 when they enter the ledger, and back to the display scale when they leave it.

## Consequences

### Positive

- One ledger per currency, regardless of display scale.
- Changing the asset scale of a wallet address or asset is a display change, with no ledger migration.

### Negative

- Asset scales above 20 are not supported. Supporting one would require migrating the whole ledger.
- Amounts at scale 20 are large and need `bigint` throughout.
