FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/indexer/package.json apps/indexer/package.json
RUN pnpm install --frozen-lockfile
COPY apps/indexer apps/indexer
CMD ["pnpm", "--dir", "apps/indexer", "run"]
