# The API of ao-sample for the deployer of the kit, built from the root of the repo (npm workspaces). It is not public:
# only the apps of the same environment reach it, on the Docker network, as http://api:3001.
FROM node:24-bookworm-slim AS build

WORKDIR /app

# --ignore-scripts: the root prepare script installs the Git hooks of the kit, which are not in the build context.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN npm ci --ignore-scripts

COPY apps/api/ apps/api/
RUN npm run build -w api

# The runtime dependencies of the API only: no devDependencies, nothing of the web.
FROM node:24-bookworm-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev --ignore-scripts --workspace api

FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PORT=3001

WORKDIR /app

# Owned by root: the node user reads the code but cannot change it.
COPY --from=deps /app/node_modules/ ./node_modules/
COPY apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist/ ./apps/api/dist/

# The image's own non-root user. Port 3001 needs no capability, so the container runs with --cap-drop ALL and
# --security-opt no-new-privileges. Nest listens on every address of the container.
USER node
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "dist/main.js"]
