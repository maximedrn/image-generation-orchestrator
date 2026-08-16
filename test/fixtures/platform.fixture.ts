import { Database } from "bun:sqlite";
import {
  AuthMode,
  EngineBackend,
  EngineProvider,
} from "@app/core/config/config.constants";
import type {
  EngineConfig,
  PlatformConfig,
} from "@app/core/config/config.types";
import { DatabaseSettings } from "@app/infrastructure/database/database.constants";
import * as schema from "@app/infrastructure/database/database.schema";
import type {
  DatabaseServiceShape,
  PlatformDatabase,
} from "@app/infrastructure/database/database.types";
import { JobStatus, OutputFormat } from "@app/modules/jobs/job.constants";
import type { Job, JobCreateRequest } from "@app/modules/jobs/job.types";
import { TestInstant } from "@test/fixtures/test.constants";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Option } from "effect";

/** Canonical identifiers shared by every deterministic test. */
const TestIdentifier = {
  engine: "engine-a",
  model: "default",
  remoteJob: "remote-existing",
} as const;

/** Stable request fixture reused across unit and integration tests. */
const JobRequestFixture: JobCreateRequest = {
  cfgScale: 7,
  count: 1,
  height: 512,
  model: TestIdentifier.model,
  outputFormat: OutputFormat.png,
  prompt: "a typed test image",
  seed: 42,
  steps: 20,
  width: 512,
};

/**
 * Creates a complete valid configuration with an overridable storage root.
 *
 * @param {string} storageRoot - Test storage path.
 * @returns {PlatformConfig} Complete immutable configuration fixture.
 */
const createPlatformConfigFixture = (storageRoot: string): PlatformConfig => ({
  engines: [
    {
      backend: EngineBackend.cpu,
      circuitBreaker: { cooldownSeconds: 30, failureThreshold: 3 },
      id: TestIdentifier.engine,
      maxConcurrent: 1,
      models: [TestIdentifier.model],
      provider: EngineProvider.stableDiffusionCpp,
      requestTimeoutSeconds: 1,
      url: "http://127.0.0.1:18080",
    },
  ],
  limits: {
    maxBatch: 4,
    maxHeight: 2048,
    maxInputBytes: 65_536,
    maxJobCost: 134_217_728,
    maxPixels: 4_194_304,
    maxSteps: 80,
    maxWidth: 2048,
  },
  modelSource: { directory: "./models", downloads: [] },
  models: { [TestIdentifier.model]: { maxHeight: 2048, maxWidth: 2048 } },
  queue: {
    leaseSeconds: 120,
    maxAttempts: 3,
    maxQueuedJobs: 100,
    maxRunningJobs: 1,
    pollIntervalMs: 50,
    recoveryIntervalSeconds: 1,
  },
  rateLimit: { maxRequests: 10, maxTrackedClients: 100, windowSeconds: 60 },
  security: { apiKey: "test-secret", auth: AuthMode.bearer },
  server: {
    bodyLimitBytes: 1_048_576,
    host: "127.0.0.1",
    port: 3000,
    trustProxy: false,
  },
  storage: { root: storageRoot },
});

/**
 * Creates one deterministic queued job fixture.
 *
 * @param {string} id - Durable job identifier.
 * @returns {Job} Queued test job.
 */
const createJobFixture = (id: string): Job => {
  const timestamp: string = TestInstant.created;
  return {
    attempt: 0,
    cancelRequested: false,
    cost: 5_242_880,
    createdAt: timestamp,
    id,
    request: JobRequestFixture,
    status: JobStatus.queued,
    updatedAt: timestamp,
  };
};

/**
 * Reads the first engine from a fixture configuration without unsafe assertions.
 *
 * @param {PlatformConfig} config - Complete test configuration.
 * @returns {EngineConfig} Required first engine fixture.
 */
const getFirstEngineFixture = (config: PlatformConfig): EngineConfig => {
  const engineOption: Option.Option<EngineConfig> = Option.fromNullable(
    config.engines[0],
  );
  if (Option.isNone(engineOption)) {
    throw new Error("platform fixture must contain at least one engine");
  }
  return engineOption.value;
};

/**
 * Creates one migrated in-memory database for repository-level tests.
 *
 * @returns {DatabaseServiceShape} Migrated database and its raw client.
 */
const createTestDatabase = (): DatabaseServiceShape => {
  const client: Database = new Database(":memory:", { strict: true });
  const database: PlatformDatabase = drizzle({ client, schema });
  migrate(database, { migrationsFolder: DatabaseSettings.migrationsFolder });
  return { client, database };
};

export {
  createJobFixture,
  createPlatformConfigFixture,
  createTestDatabase,
  getFirstEngineFixture,
  JobRequestFixture,
  TestIdentifier,
};
