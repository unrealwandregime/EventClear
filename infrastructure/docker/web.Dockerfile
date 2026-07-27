FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml* package-lock.json* ./
RUN corepack enable && pnpm install --frozen-lockfile=false
COPY . .
RUN pnpm build
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["corepack", "pnpm", "start"]
