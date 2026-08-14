FROM oven/bun:1.3.14-alpine AS build
WORKDIR /workspace
COPY package.json bunfig.toml tsconfig.json ./
RUN bun install --production
COPY src ./src
RUN bun run build

FROM oven/bun:1.3.14-alpine AS runtime
WORKDIR /app
RUN addgroup -S platform && adduser -S -G platform platform
COPY --from=build --chown=platform:platform /workspace/dist/main.js /app/main.js
USER platform
ENV NODE_ENV=production \
  PLATFORM_CONFIG=/config/platform.yaml
EXPOSE 3000
ENTRYPOINT ["bun", "--smol", "/app/main.js"]
