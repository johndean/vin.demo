# VIN Demo engine — hosted, auth-gated live-session streaming service.
# Built on the official Playwright image (Chromium + all system libs preinstalled) matching the
# Playwright version locked in package-lock.json (1.60.0). Reuses the ROOT package.json/deps and
# the shared src/core engine, so the Railway build context must be the REPO ROOT (set the service's
# Root Directory to "/").
FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app
ENV PORT=8080

# Install root deps (langgraph, pg, @anthropic-ai/sdk, voyageai, dotenv, tsx). tsx lives in
# devDependencies and is needed at runtime, so include dev. The base image already ships the
# matching Chromium under /ms-playwright, so no browser download is needed.
COPY package.json package-lock.json* ./
RUN npm ci --include=dev --no-audit --no-fund

# Shared engine source + the engine service (apps/engine/src/index.ts imports ../../../src/core/*).
COPY tsconfig.json ./
COPY src ./src
COPY apps/engine ./apps/engine

# Writable screenshot scratch dir, owned by the non-root browser user so Chromium's sandbox works
# without --no-sandbox. node_modules and src stay root-owned (read-only to the running app).
RUN mkdir -p /app/tmp/live && chown -R pwuser:pwuser /app/tmp
USER pwuser

EXPOSE 8080
CMD ["npm", "run", "engine"]
