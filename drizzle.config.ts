import { type Config, defineConfig } from "drizzle-kit";

const config: Config = defineConfig({
  dialect: "sqlite",
  out: "src/infrastructure/database/drizzle",
  schema: "src/infrastructure/database/database.schema.ts",
  strict: true,
  verbose: true,
});

export default config;
