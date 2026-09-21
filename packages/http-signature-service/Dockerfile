FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true
RUN corepack enable
RUN corepack prepare pnpm@10.28.2 --activate

WORKDIR /workspace

COPY pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch

FROM base AS prod-deps
COPY package.json pnpm-workspace.yaml ./
COPY packages/http-signature-service/package.json ./packages/http-signature-service/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --recursive --prefer-offline --frozen-lockfile --prod

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --filter http-signature-service... --frozen-lockfile
RUN pnpm --filter http-signature-service build

FROM node:24-alpine AS runner
WORKDIR /workspace

# root + package node_modules from prod-deps
COPY --from=prod-deps /workspace/node_modules ./node_modules
COPY --from=prod-deps /workspace/packages/http-signature-service/node_modules ./packages/http-signature-service/node_modules

# package.json for the workspace package
COPY --from=prod-deps /workspace/packages/http-signature-service/package.json ./packages/http-signature-service/package.json

# built dist
COPY --from=build /workspace/packages/http-signature-service/dist ./packages/http-signature-service/dist

CMD ["node", "packages/http-signature-service/dist/index.js"]
