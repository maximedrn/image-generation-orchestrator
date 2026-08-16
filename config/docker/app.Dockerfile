# syntax=docker/dockerfile:1.19
FROM oven/bun:1.3.14-alpine AS build

WORKDIR /workspace

COPY package.json bun.lock bunfig.toml tsconfig.json build.ts ./

# The cache mount survives across builds, so a lockfile that did not change
# resolves from disk instead of the network.
# --ignore-scripts: the prepare hook installs lefthook, a devDependency that
# is absent from a production install and useless without a git directory.
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
  bun install --frozen-lockfile --production --ignore-scripts

COPY src ./src

RUN bun run build

FROM alpine:3.24.1 AS runtime

# The data directory must exist and be owned before the volume is mounted:
# Docker seeds a fresh named volume from the image, so a missing directory
# yields a root-owned volume the unprivileged user cannot write to.
RUN --mount=type=cache,target=/var/cache/apk,sharing=locked \
  apk add --no-cache ca-certificates libgcc libstdc++ \
  && addgroup -S platform \
  && adduser -S -G platform platform \
  && mkdir -p /var/lib/stable-diffusion-platform \
  && chown platform:platform /var/lib/stable-diffusion-platform

WORKDIR /app

COPY --from=build --chown=platform:platform \
  /workspace/dist/stable-diffusion-platform \
  /app/stable-diffusion-platform

# Mirrors the repository layout so the migrations folder resolves to the
# same relative path in development and inside the image.
COPY --chown=platform:platform \
  src/infrastructure/database/drizzle \
  /app/src/infrastructure/database/drizzle

USER platform

ENV NODE_ENV=production
ENV PLATFORM_CONFIG=/config/platform.yaml

EXPOSE 3000

ENTRYPOINT ["/app/stable-diffusion-platform"]
