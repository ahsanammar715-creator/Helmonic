# syntax=docker/dockerfile:1

FROM node:22.22.2-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22.22.2-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22.22.2-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=80

# PHASE 1A TUESDAY DEMO EXCEPTION ONLY.
# Azure Container Apps does not honor the executable capability used by the
# previous non-root image to bind the app's existing target port 80. Keep this
# exception scoped to the protected demo endpoint and remove it before any
# broader use. The required non-root/port-8080 exit gate is recorded in
# docs/phase1a-tuesday-runtime-exception.md.
LABEL com.helmonic.runtime-exception="phase1a-tuesday-demo-root-port80" \
      com.helmonic.runtime-exception.expires="2026-08-25T23:59:59Z"

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Explicit so the temporary exception is visible to image scanners and review.
USER 0
EXPOSE 80
CMD ["node", "server.js"]
