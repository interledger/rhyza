FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true
RUN corepack enable
RUN corepack prepare pnpm@10.28.2 --activate

WORKDIR /workspace

RUN apk update && apk add --no-cache \
    libc6-compat \
    librdkafka-dev \
    cyrus-sasl-dev \
    openssl-dev \
    gcc \
    g++ \
    python3 \
    make \
    musl-dev

COPY pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch

FROM base AS prod-deps
COPY package.json pnpm-workspace.yaml ./
COPY packages/common-types-lib/package.json ./packages/common-types-lib/package.json
COPY packages/implementations-lib/package.json ./packages/implementations-lib/package.json
COPY packages/pal-public-types-lib/package.json ./packages/pal-public-types-lib/package.json
COPY packages/pal-client-lib/package.json ./packages/pal-client-lib/package.json
COPY packages/payments-public-types-lib/package.json ./packages/payments-public-types-lib/package.json
COPY packages/payments-client-lib/package.json ./packages/payments-client-lib/package.json
COPY packages/open-payments-resource-service/package.json ./packages/open-payments-resource-service/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store BUILD_LIBRDKAFKA=0 pnpm install --recursive --prefer-offline --frozen-lockfile --prod

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store BUILD_LIBRDKAFKA=0 pnpm install --frozen-lockfile
RUN pnpm --filter common-types-lib build
RUN pnpm --filter implementations-lib build
RUN pnpm --filter pal-public-types-lib build
RUN pnpm --filter pal-client-lib build
RUN pnpm --filter payments-public-types-lib build
RUN pnpm --filter payments-client-lib build
RUN pnpm --filter open-payments-resource-service build

FROM node:24-alpine AS runner
WORKDIR /workspace

# root + per-package node_modules from prod-deps
COPY --from=prod-deps /workspace/node_modules ./node_modules
COPY --from=prod-deps /workspace/packages/implementations-lib/node_modules ./packages/implementations-lib/node_modules
COPY --from=prod-deps /workspace/packages/pal-public-types-lib/node_modules ./packages/pal-public-types-lib/node_modules
COPY --from=prod-deps /workspace/packages/pal-client-lib/node_modules ./packages/pal-client-lib/node_modules
COPY --from=prod-deps /workspace/packages/payments-public-types-lib/node_modules ./packages/payments-public-types-lib/node_modules
COPY --from=prod-deps /workspace/packages/payments-client-lib/node_modules ./packages/payments-client-lib/node_modules
COPY --from=prod-deps /workspace/packages/open-payments-resource-service/node_modules ./packages/open-payments-resource-service/node_modules

# package.json for each workspace dep
COPY --from=prod-deps /workspace/packages/common-types-lib/package.json ./packages/common-types-lib/package.json
COPY --from=prod-deps /workspace/packages/implementations-lib/package.json ./packages/implementations-lib/package.json
COPY --from=prod-deps /workspace/packages/pal-public-types-lib/package.json ./packages/pal-public-types-lib/package.json
COPY --from=prod-deps /workspace/packages/pal-client-lib/package.json ./packages/pal-client-lib/package.json
COPY --from=prod-deps /workspace/packages/payments-public-types-lib/package.json ./packages/payments-public-types-lib/package.json
COPY --from=prod-deps /workspace/packages/payments-client-lib/package.json ./packages/payments-client-lib/package.json
COPY --from=prod-deps /workspace/packages/open-payments-resource-service/package.json ./packages/open-payments-resource-service/package.json

# built dist from each workspace dep
COPY --from=build /workspace/packages/common-types-lib/dist ./packages/common-types-lib/dist
COPY --from=build /workspace/packages/implementations-lib/dist ./packages/implementations-lib/dist
COPY --from=build /workspace/packages/pal-public-types-lib/dist ./packages/pal-public-types-lib/dist
COPY --from=build /workspace/packages/pal-client-lib/dist ./packages/pal-client-lib/dist
COPY --from=build /workspace/packages/payments-public-types-lib/dist ./packages/payments-public-types-lib/dist
COPY --from=build /workspace/packages/payments-client-lib/dist ./packages/payments-client-lib/dist
COPY --from=build /workspace/packages/open-payments-resource-service/dist ./packages/open-payments-resource-service/dist
COPY --from=build /workspace/open-payments-specifications/json/resource-server.json ./open-payments-specifications/json/resource-server.json

CMD ["node", "packages/open-payments-resource-service/dist/index.js"]
