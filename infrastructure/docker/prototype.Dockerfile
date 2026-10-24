FROM node:22-trixie-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca npm_config_cafile=/run/secrets/build_ca; fi; \
    export NODE_USE_ENV_PROXY=1; npm install -g pnpm@10.15.0 && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
FROM python:3.12-slim-trixie
COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build /usr/lib/*/libstdc++.so.6 /usr/local/lib/
COPY --from=build /lib/*/libgcc_s.so.1 /usr/local/lib/
ENV LD_LIBRARY_PATH=/usr/local/lib NODE_ENV=production PYTHONUNBUFFERED=1
WORKDIR /app
COPY apps/solver /solver
COPY apps/api /api
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export PIP_CERT=/run/secrets/build_ca; fi; \
    pip install --no-cache-dir /solver /api
COPY --from=build --chown=65532:65532 /app /app
COPY infrastructure/docker/postgres/migrations /app/migrations
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx
USER 65532:65532
EXPOSE 10000
CMD ["python", "scripts/prototype/supervise.py"]
