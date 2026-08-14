import { AUTH_MODE, ENGINE_BACKEND, ENGINE_PROVIDER } from "@app/config/config.constants.js";
import type { EngineConfig, PlatformConfig } from "@app/config/config.types.js";
import { JOB_STATUS, OUTPUT_FORMAT } from "@app/job/job.constants.js";
import type { Job, JobCreateRequest } from "@app/job/job.types.js";

/** Canonical engine identifier used by deterministic tests. */
const TEST_ENGINE_ID: string = "engine-a";

/** Canonical model identifier used by deterministic tests. */
const TEST_MODEL_ID: string = "default";

/** Canonical remote job identifier used by recovery tests. */
const TEST_REMOTE_JOB_ID: string = "remote-existing";

/** Stable request fixture reused across unit and integration tests. */
const JOB_REQUEST_FIXTURE: JobCreateRequest = {
  cfgScale: 7,
  count: 1,
  height: 512,
  model: TEST_MODEL_ID,
  outputFormat: OUTPUT_FORMAT.PNG,
  prompt: "a typed test image",
  seed: 42,
  steps: 20,
  width: 512,
};

/**
 * Creates a complete valid configuration with an overridable storage root.
 *
 * @param storageRoot - (string) Test storage path.
 * @returns (PlatformConfig) Complete immutable configuration fixture.
 */
const createPlatformConfigFixture = (storageRoot: string): PlatformConfig => ({
  engines: [
    {
      backend: ENGINE_BACKEND.CPU,
      circuitBreaker: { cooldownSeconds: 30, failureThreshold: 3 },
      id: TEST_ENGINE_ID,
      maxConcurrent: 1,
      models: [TEST_MODEL_ID],
      provider: ENGINE_PROVIDER.STABLE_DIFFUSION_CPP,
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
  models: { [TEST_MODEL_ID]: { maxHeight: 2048, maxWidth: 2048 } },
  queue: {
    leaseSeconds: 120,
    maxAttempts: 3,
    maxQueuedJobs: 100,
    maxRunningJobs: 1,
    pollIntervalMs: 50,
    recoveryIntervalSeconds: 1,
  },
  rateLimit: { maxRequests: 10, maxTrackedClients: 100, windowSeconds: 60 },
  security: { apiKey: "test-secret", apiKeyEnv: "TEST_API_KEY", auth: AUTH_MODE.BEARER },
  server: { bodyLimitBytes: 1_048_576, host: "127.0.0.1", port: 3000 },
  storage: { root: storageRoot },
});

/**
 * Creates one deterministic queued job fixture.
 *
 * @param id - (string) Durable job identifier.
 * @returns (Job) Queued test job.
 */
const createJobFixture = (id: string): Job => {
  const timestamp: string = "2026-08-14T12:00:00.000Z";
  return {
    attempt: 0,
    cancelRequested: false,
    cost: 5_242_880,
    createdAt: timestamp,
    id,
    request: JOB_REQUEST_FIXTURE,
    status: JOB_STATUS.QUEUED,
    updatedAt: timestamp,
  };
};

/**
 * Reads the first engine from a fixture configuration without unsafe assertions.
 *
 * @param config - (PlatformConfig) Complete test configuration.
 * @returns (EngineConfig) Required first engine fixture.
 */
const getFirstEngineFixture = (config: PlatformConfig): EngineConfig => {
  const engine: EngineConfig | undefined = config.engines[0];
  if (engine === undefined) {
    throw new Error("platform fixture must contain at least one engine");
  }
  return engine;
};

export {
  createJobFixture,
  createPlatformConfigFixture,
  getFirstEngineFixture,
  JOB_REQUEST_FIXTURE,
  TEST_ENGINE_ID,
  TEST_MODEL_ID,
  TEST_REMOTE_JOB_ID,
};
