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
COPY packages/notifications-domain-lib/package.json ./packages/notifications-domain-lib/package.json
COPY packages/notifications-implementations-lib/package.json ./packages/notifications-implementations-lib/package.json
COPY packages/payments-public-types-lib/package.json ./packages/payments-public-types-lib/package.json
COPY packages/notifications-command-handler-service/package.json ./packages/notifications-command-handler-service/package.json

RUN --mount=type=cache,id=pnpm,target=/pnpm/store BUILD_LIBRDKAFKA=0 pnpm install --recursive --prefer-offline --frozen-lockfile --prod

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store BUILD_LIBRDKAFKA=0 pnpm install --frozen-lockfile
RUN pnpm --filter common-types-lib build
RUN pnpm --filter implementations-lib build
RUN pnpm --filter notifications-domain-lib build
RUN pnpm --filter payments-public-types-lib build
RUN pnpm --filter notifications-implementations-lib build
RUN pnpm --filter notifications-command-handler-service build

FROM node:24-alpine AS runner
RUN apk update && apk add --no-cache librdkafka
WORKDIR /workspace

# root + per-package node_modules from prod-deps
COPY --from=prod-deps /workspace/node_modules ./node_modules
COPY --from=prod-deps /workspace/packages/implementations-lib/node_modules ./packages/implementations-lib/node_modules
COPY --from=prod-deps /workspace/packages/notifications-domain-lib/node_modules ./packages/notifications-domain-lib/node_modules
COPY --from=prod-deps /workspace/packages/notifications-implementations-lib/node_modules ./packages/notifications-implementations-lib/node_modules
COPY --from=prod-deps /workspace/packages/payments-public-types-lib/node_modules ./packages/payments-public-types-lib/node_modules
COPY --from=prod-deps /workspace/packages/notifications-command-handler-service/node_modules ./packages/notifications-command-handler-service/node_modules

# package.json for each workspace dep
COPY --from=prod-deps /workspace/packages/common-types-lib/package.json ./packages/common-types-lib/package.json
COPY --from=prod-deps /workspace/packages/implementations-lib/package.json ./packages/implementations-lib/package.json
COPY --from=prod-deps /workspace/packages/notifications-domain-lib/package.json ./packages/notifications-domain-lib/package.json
COPY --from=prod-deps /workspace/packages/notifications-implementations-lib/package.json ./packages/notifications-implementations-lib/package.json
COPY --from=prod-deps /workspace/packages/payments-public-types-lib/package.json ./packages/payments-public-types-lib/package.json
COPY --from=prod-deps /workspace/packages/notifications-command-handler-service/package.json ./packages/notifications-command-handler-service/package.json

# built dist from each workspace dep
COPY --from=build /workspace/packages/common-types-lib/dist ./packages/common-types-lib/dist
COPY --from=build /workspace/packages/implementations-lib/dist ./packages/implementations-lib/dist
COPY --from=build /workspace/packages/notifications-domain-lib/dist ./packages/notifications-domain-lib/dist
COPY --from=build /workspace/packages/notifications-implementations-lib/dist ./packages/notifications-implementations-lib/dist
COPY --from=build /workspace/packages/payments-public-types-lib/dist ./packages/payments-public-types-lib/dist
COPY --from=build /workspace/packages/notifications-command-handler-service/dist ./packages/notifications-command-handler-service/dist

CMD ["node", "packages/notifications-command-handler-service/dist/index.js"]
