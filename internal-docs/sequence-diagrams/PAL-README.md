# PAL services

PAL has three main services:

- PAL API Service
- Ledger Command Handler Service
- Event Handler Service

## PAL API Service

This service is the endpoint for all request-response communication style functionality for the PAL, it serves over gRPC in a sync request-response style and has a TypeScript client implementation available.

Main features:

- All Peers functionality - Create, manage and query peers
- All Asset functionality - Create, manage and query peers
- Liquidity management functionality - Create and manage ledgers and ledger accounts
- Liquidity queries

Note: Ledger high performance requests, such as posting transactions, are handled by a saga pattern style of communications and are not available via the gRPC API. See command handler for details.

## Ledger Command Handler Service

This command handler service is responsible for handling ledger command messages, for as posting transactions and managing ledgers and ledger accounts. It uses a saga pattern style of communications to handle high performance requests.
Commands are passed to the domain code for processing, the result is the publishing of domain/integration events (success or falure).
