FROM oven/bun:1.3.14-alpine AS build
WORKDIR /workspace
COPY package.json bunfig.toml tsconfig.json ./
RUN bun install --production
COPY src ./src
COPY scripts ./scripts
RUN bun run build:musl

FROM alpine:3.24.1 AS runtime
RUN apk add --no-cache ca-certificates libgcc libstdc++ \
  && addgroup -S platform \
  && adduser -S -G platform platform
WORKDIR /app
COPY --from=build --chown=platform:platform \
  /workspace/dist/stable-diffusion-platform \
  /app/stable-diffusion-platform
USER platform
ENV NODE_ENV=production \
  PLATFORM_CONFIG=/config/platform.yaml
EXPOSE 3000
ENTRYPOINT ["/app/stable-diffusion-platform"]
