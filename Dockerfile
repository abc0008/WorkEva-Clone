FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
# Deploy this target separately for the durable outbox worker. Keeping it as a
# target makes the worker use the same lock/store and dependency versions as the
# web image; no worker loop is started by the web process.
FROM build AS worker
ENV NODE_ENV=production
CMD ["node", "--import", "tsx", "scripts/worker.ts"]

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
USER node
CMD ["node", "server.js"]
