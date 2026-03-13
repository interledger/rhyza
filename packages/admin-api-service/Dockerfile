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
COPY packages/pal-public-types-lib/package.json ./packages/pal-public-types-lib/package.json
COPY packages/pal-client-lib/package.json ./packages/pal-client-lib/package.json
COPY packages/payments-public-types-lib/package.json ./packages/payments-public-types-lib/package.json
COPY packages/payments-client-lib/package.json ./packages/payments-client-lib/package.json
COPY packages/admin-api-service/package.json ./packages/admin-api-service/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store BUILD_LIBRDKAFKA=0 pnpm install --recursive --prefer-offline --frozen-lockfile --prod

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store BUILD_LIBRDKAFKA=0 pnpm install --frozen-lockfile
RUN pnpm --filter pal-public-types-lib build
RUN pnpm --filter pal-client-lib build
RUN pnpm --filter payments-public-types-lib build
RUN pnpm --filter payments-client-lib build
RUN pnpm --filter admin-api-service build

FROM node:24-alpine AS runner
WORKDIR /workspace

# root + per-package node_modules from prod-deps
COPY --from=prod-deps /workspace/node_modules ./node_modules
COPY --from=prod-deps /workspace/packages/pal-public-types-lib/node_modules ./packages/pal-public-types-lib/node_modules
COPY --from=prod-deps /workspace/packages/pal-client-lib/node_modules ./packages/pal-client-lib/node_modules
COPY --from=prod-deps /workspace/packages/payments-public-types-lib/node_modules ./packages/payments-public-types-lib/node_modules
COPY --from=prod-deps /workspace/packages/payments-client-lib/node_modules ./packages/payments-client-lib/node_modules
COPY --from=prod-deps /workspace/packages/admin-api-service/node_modules ./packages/admin-api-service/node_modules

# package.json for each workspace dep
COPY --from=prod-deps /workspace/packages/pal-public-types-lib/package.json ./packages/pal-public-types-lib/package.json
COPY --from=prod-deps /workspace/packages/pal-client-lib/package.json ./packages/pal-client-lib/package.json
COPY --from=prod-deps /workspace/packages/payments-public-types-lib/package.json ./packages/payments-public-types-lib/package.json
COPY --from=prod-deps /workspace/packages/payments-client-lib/package.json ./packages/payments-client-lib/package.json
COPY --from=prod-deps /workspace/packages/admin-api-service/package.json ./packages/admin-api-service/package.json

# built dist from each workspace dep
COPY --from=build /workspace/packages/pal-public-types-lib/dist ./packages/pal-public-types-lib/dist
COPY --from=build /workspace/packages/pal-client-lib/dist ./packages/pal-client-lib/dist
COPY --from=build /workspace/packages/payments-public-types-lib/dist ./packages/payments-public-types-lib/dist
COPY --from=build /workspace/packages/payments-client-lib/dist ./packages/payments-client-lib/dist
COPY --from=build /workspace/packages/admin-api-service/dist ./packages/admin-api-service/dist

CMD ["node", "packages/admin-api-service/dist/index.js"]
