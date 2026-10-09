FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true
RUN corepack enable
RUN corepack prepare pnpm@10.28.2 --activate

WORKDIR /workspace

FROM base AS build
RUN apk add --no-cache libc6-compat

COPY pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch

COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prefer-offline --frozen-lockfile
RUN pnpm --filter payments-event-handler-service... build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm deploy --legacy --prod --filter payments-event-handler-service /out

FROM node:24-alpine AS runner
WORKDIR /workspace
COPY --from=build /out ./packages/payments-event-handler-service
USER node

CMD ["node", "packages/payments-event-handler-service/dist/index.js"]
