# PAL API Service Library

A TypeScript library that implements the Peers, Accounts and Liquidity (PAL) gRPC service interface.

## Overview

This library provides the server-side implementation of the PAL gRPC service, handling asset management and wallet operations. It includes support for gRPC reflection and health checking capabilities.

## Usage

## Install and build

```bash
pnpm i
pnpm build
```

## Running

```bash
MONGO_URL=mongodb://root:myPass@localhost:27017/ pnpm start
```

Set `REDIS_URL` (e.g. `redis://localhost:6379`) to cache wallet address lookups in Redis. Entries expire after `WALLET_ADDRESS_CACHE_TTL_MS` (default 5 minutes) as a safety net, since writes already evict what they change. Without `REDIS_URL`, every lookup reads Mongo.

### Testing

```bash
pnpm test
```

## API Reference

Check the proto files in [pal-public-types-lib](../pal-public-types-lib) for the gRPC and protobuf api definition,
OR
Use the [pal-client-lib](../pal-client-lib) for a ready-made Typescript client.
