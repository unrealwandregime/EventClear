FROM node:22-alpine
WORKDIR /app
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY apps/indexer/package.json apps/indexer/package.json
RUN pnpm install --frozen-lockfile
COPY apps/indexer apps/indexer
ARG DATABASE_CA_URL=""
RUN if [ -n "$DATABASE_CA_URL" ]; then node -e "fetch(process.env.DATABASE_CA_URL).then(r=>{if(!r.ok)throw Error('DATABASE_CA_DOWNLOAD_FAILED');return r.text()}).then(t=>require('fs').writeFileSync('/etc/ssl/certs/rds-global-bundle.pem',t))"; fi
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx && chown -R node:node /app
USER node
CMD ["node", "--import", "tsx", "apps/indexer/src/index.ts", "run"]
