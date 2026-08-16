/** Optional NestJS/Fastify integrations this HTTP-only binary never loads. */
const externalPackages: readonly string[] = [
  "@fastify/static",
  "@fastify/view",
  "@nestjs/microservices*",
  "@nestjs/platform-express*",
  "@nestjs/platform-socket.io*",
  "@nestjs/websockets*",
  "class-*",
];

// Compiles for the host platform: the image builder already runs a musl Bun.
// `Bun.build` rejects with an AggregateError on failure, so no error handling.
await Bun.build({
  bytecode: true,
  compile: {
    autoloadBunfig: false,
    autoloadDotenv: false,
    outfile: "dist/image-generation-orchestrator",
  },
  entrypoints: ["src/main.ts"],
  external: [...externalPackages],
  minify: true,
  target: "bun",
});
