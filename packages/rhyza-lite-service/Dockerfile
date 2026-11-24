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
RUN pnpm --filter 'rhyza-lite-service...' build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm deploy --legacy --prod --filter rhyza-lite-service /out
# The open-payments services import ../../../open-payments-specifications/json/<name>.json
# relative to their dist. After deploy their dist sits inside node_modules/.pnpm, so the
# spec has to be copied next to it (their own Dockerfiles copy it to /workspace instead).
RUN set -e; for pair in auth-service:auth-server resource-service:resource-server; do \
      svc="open-payments-${pair%%:*}"; spec="${pair##*:}.json"; \
      dest="$(cd -P "/out/node_modules/${svc}/dist/../../.." && pwd)/open-payments-specifications/json"; \
      mkdir -p "$dest" && cp "open-payments-specifications/json/${spec}" "$dest/"; \
    done

FROM node:24-alpine AS runner
WORKDIR /workspace
COPY --from=build /out ./packages/rhyza-lite-service
USER node

CMD ["node", "packages/rhyza-lite-service/dist/index.js"]
