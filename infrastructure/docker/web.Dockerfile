FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY patches ./patches
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
FROM node:22-alpine
WORKDIR /app
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx
COPY --from=build --chown=node:node /app ./
USER node
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "node_modules/vinext/dist/cli.js", "start", "--port", "3000"]
