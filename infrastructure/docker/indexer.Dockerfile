FROM node:22-alpine
WORKDIR /app
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY apps/indexer/package.json apps/indexer/package.json
RUN pnpm install --frozen-lockfile
COPY apps/indexer apps/indexer
RUN node -e "fetch('https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem').then(r=>{if(!r.ok)throw Error('RDS_CA_DOWNLOAD_FAILED');return r.text()}).then(t=>require('fs').writeFileSync('/etc/ssl/certs/rds-global-bundle.pem',t))"
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx && chown -R node:node /app /opt/corepack
USER node
CMD ["pnpm", "--dir", "apps/indexer", "run"]
