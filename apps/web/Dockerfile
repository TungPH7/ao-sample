# The web app of ao-sample for the deployer of the kit, built from the root of the repo (npm workspaces): Caddy in front
# keeps HTTPS and basic auth, and the web is the only public app of the environment.
FROM node:24-bookworm-slim AS build

ENV NEXT_TELEMETRY_DISABLED=1 \
    # ADR-0002: the web forwards /api/notes to the API. On the VPS the API is the app `api` on the Docker network of the
    # environment, the same name in every environment, and next build writes the rewrite into the build, so it is set
    # here and not when the container starts.
    API_URL=http://api:3001

WORKDIR /app

# --ignore-scripts: the root prepare script installs the Git hooks of the kit, which are not in the build context.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN npm ci --ignore-scripts

# The web imports the note rules from the API source (ADR-0001), so both apps are copied.
COPY apps/web/ apps/web/
COPY apps/api/ apps/api/
RUN npm run build -w web

FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    # Listen on every address of the container, not only on localhost.
    HOSTNAME=0.0.0.0 \
    PORT=3000

WORKDIR /app

# The standalone server holds only the modules it uses. Owned by root: the node user reads the code but cannot change it.
COPY --from=build /app/apps/web/.next/standalone/ ./
COPY --from=build /app/apps/web/.next/static/ ./apps/web/.next/static/
# The one directory the server may write to, for its own cache.
RUN mkdir -p apps/web/.next/cache && chown node:node apps/web/.next/cache

# The image's own non-root user. Port 3000 needs no capability, so the container runs with --cap-drop ALL and
# --security-opt no-new-privileges.
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
