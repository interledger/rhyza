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

### Testing

```bash
pnpm test
```

## API Reference

Check the proto files in [pal-public-types-lib](../pal-public-types-lib) for the gRPC and protobuf api definition,
OR
Use the [pal-client-lib](../pal-client-lib) for a ready-made Typescript client.
