import type {
  EngineConfig,
  PlatformConfig,
} from "@app/core/config/config.types";
import { StorageError } from "@app/core/errors/error.types";
import type { DatabaseServiceShape } from "@app/infrastructure/database/database.types";
import { createJobRepository } from "@app/infrastructure/database/repository/job-repository.service";
import type { DispatcherWorkerDependencies } from "@app/infrastructure/dispatcher/dispatcher.types";
import { EngineJobStatus } from "@app/infrastructure/engine/engine.constants";
import type {
  EngineGatewayError,
  EngineGatewayShape,
  EnginePoolShape,
} from "@app/infrastructure/engine/engine.interface";
import type {
  EngineCapabilities,
  EngineJob,
  EngineReservation,
  EngineSubmission,
  EngineView,
} from "@app/infrastructure/engine/engine.types";
import type {
  ResultStorageShape,
  StoredResult,
} from "@app/infrastructure/storage/storage.interface";
import { OutputFormat } from "@app/modules/jobs/job.constants";
import type { JobRepositoryShape } from "@app/modules/jobs/job.interface";
import type {
  Job,
  JobResult,
  OutputFormatValue,
} from "@app/modules/jobs/job.types";
import {
  createJobFixture,
  createPlatformConfigFixture,
  createTestDatabase,
  getFirstEngineFixture,
} from "@test/fixtures/platform.fixture";
import {
  TestImagePayload,
  TestRemoteJobId,
} from "@test/fixtures/test.constants";
import { Effect, Option } from "effect";

/** Remote identifier every scripted gateway hands back on submission. */
const RemoteJobId: string = TestRemoteJobId.dispatch;

/** Upstream calls a scenario can assert on after the worker settles. */
interface GatewayCalls {
  cancel: number;
  poll: number;
  submit: number;
}

/** Scheduler signals a scenario can assert on after the worker settles. */
interface PoolCalls {
  failure: number;
  release: number;
  success: number;
}

/** Behaviour a scripted gateway follows for one scenario. */
interface GatewayScript {
  /** Remote responses handed back on successive poll or cancel calls. */
  readonly responses: readonly EngineJob[];
  /** When set, submission fails with this error instead of succeeding. */
  readonly submitError?: EngineGatewayError;
}

/** Everything one scenario needs to drive and then inspect a worker run. */
interface WorkerHarness {
  readonly config: PlatformConfig;
  readonly database: DatabaseServiceShape;
  readonly dependencies: DispatcherWorkerDependencies;
  readonly engine: EngineConfig;
  readonly gatewayCalls: GatewayCalls;
  readonly poolCalls: PoolCalls;
  readonly repository: JobRepositoryShape;
  readonly reservation: EngineReservation;
  readonly written: string[];
}

/** Terminal remote payload carrying one decodable image. */
const completedRemoteJob = (): EngineJob => ({
  error: null,
  id: RemoteJobId,
  result: {
    images: [{ base64: TestImagePayload.short, index: 0 }],
    outputFormat: OutputFormat.png,
  },
  status: EngineJobStatus.succeeded,
});

/**
 * Builds a gateway replaying a fixed script and counting every upstream call.
 *
 * @param {GatewayScript} script - Scripted submission and poll behaviour.
 * @param {GatewayCalls} calls - Mutable counters updated in place.
 * @returns {EngineGatewayShape} Scripted provider-neutral gateway.
 */
const createScriptedGateway = (
  script: GatewayScript,
  calls: GatewayCalls,
): EngineGatewayShape => {
  const nextResponse = (index: number): EngineJob => {
    const response: EngineJob | undefined =
      script.responses[Math.min(index, script.responses.length - 1)];
    return response ?? completedRemoteJob();
  };
  return {
    cancel: (): Effect.Effect<EngineJob, EngineGatewayError> => {
      const response: EngineJob = nextResponse(calls.poll + calls.cancel);
      calls.cancel += 1;
      return Effect.succeed(response);
    },
    capabilities: (): Effect.Effect<EngineCapabilities, EngineGatewayError> =>
      Effect.succeed({ outputFormats: [], supportsImageGeneration: true }),
    poll: (): Effect.Effect<EngineJob, EngineGatewayError> => {
      const response: EngineJob = nextResponse(calls.poll + calls.cancel);
      calls.poll += 1;
      return Effect.succeed(response);
    },
    submit: (): Effect.Effect<EngineSubmission, EngineGatewayError> => {
      calls.submit += 1;
      return Option.match(Option.fromNullable(script.submitError), {
        onNone: (): Effect.Effect<EngineSubmission, EngineGatewayError> =>
          Effect.succeed({ id: RemoteJobId }),
        onSome: (
          error: EngineGatewayError,
        ): Effect.Effect<EngineSubmission, EngineGatewayError> =>
          Effect.fail(error),
      });
    },
  };
};

/**
 * Builds a scheduler port that only records the signals the worker emits.
 *
 * @param {EngineReservation} reservation - Reservation handed to every caller.
 * @param {PoolCalls} calls - Mutable counters updated in place.
 * @returns {EnginePoolShape} Recording scheduler port.
 */
const createRecordingPool = (
  reservation: EngineReservation,
  calls: PoolCalls,
): EnginePoolShape => ({
  list: (): Effect.Effect<readonly EngineView[]> => Effect.succeed([]),
  recordFailure: (): Effect.Effect<void> =>
    Effect.sync((): void => {
      calls.failure += 1;
    }),
  recordSuccess: (): Effect.Effect<void> =>
    Effect.sync((): void => {
      calls.success += 1;
    }),
  release: (): Effect.Effect<void> =>
    Effect.sync((): void => {
      calls.release += 1;
    }),
  reserve: (): Effect.Effect<Option.Option<EngineReservation>> =>
    Effect.succeed(Option.some(reservation)),
  reserveById: (): Effect.Effect<Option.Option<EngineReservation>> =>
    Effect.succeed(Option.some(reservation)),
});

/**
 * Builds an in-memory storage port, optionally failing from a given image index.
 *
 * @param {string[]} written - Mutable list of written result paths.
 * @param {number | undefined} failFromIndex - First image index that must fail.
 * @returns {ResultStorageShape} Deterministic storage port.
 */
const createMemoryStorage = (
  written: string[],
  failFromIndex?: number,
): ResultStorageShape => ({
  read: (metadata: JobResult): Effect.Effect<StoredResult, StorageError> =>
    Effect.succeed({ metadata, stream: new ReadableStream<Uint8Array>() }),
  remove: (metadata: JobResult): Effect.Effect<void, StorageError> =>
    Effect.sync((): void => {
      const position: number = written.indexOf(metadata.path);
      if (position >= 0) written.splice(position, 1);
    }),
  writeBase64: (
    jobId: string,
    index: number,
    outputFormat: OutputFormatValue,
    _base64: string,
  ): Effect.Effect<JobResult, StorageError> => {
    const rejects: boolean = Option.match(Option.fromNullable(failFromIndex), {
      onNone: (): boolean => false,
      onSome: (threshold: number): boolean => index >= threshold,
    });
    if (rejects) {
      return Effect.fail(new StorageError({ message: "disk is full" }));
    }
    const path: string = `/tmp/${jobId}-${index}.${outputFormat}`;
    written.push(path);
    return Effect.succeed({
      index,
      jobId,
      mimeType: `image/${outputFormat}`,
      path,
      sha256: `sha-${index}`,
      sizeBytes: 2,
    });
  },
});

/** Optional knobs a scenario uses to shape its harness. */
interface HarnessOptions {
  readonly failStorageFromIndex?: number;
  readonly maxAttempts?: number;
  readonly script: GatewayScript;
}

/**
 * Assembles one dispatcher worker harness over a migrated in-memory database.
 *
 * @param {HarnessOptions} options - Scenario-specific behaviour.
 * @returns {WorkerHarness} Ready-to-drive worker dependencies and probes.
 */
const createWorkerHarness = (options: HarnessOptions): WorkerHarness => {
  const base: PlatformConfig = createPlatformConfigFixture(
    "/tmp/dispatcher-worker",
  );
  const config: PlatformConfig = {
    ...base,
    queue: {
      ...base.queue,
      maxAttempts: options.maxAttempts ?? base.queue.maxAttempts,
      pollIntervalMs: 1,
    },
  };
  const database: DatabaseServiceShape = createTestDatabase();
  const repository: JobRepositoryShape = createJobRepository(database.database);
  const engine: EngineConfig = getFirstEngineFixture(config);
  const reservation: EngineReservation = { engine };
  const gatewayCalls: GatewayCalls = { cancel: 0, poll: 0, submit: 0 };
  const poolCalls: PoolCalls = { failure: 0, release: 0, success: 0 };
  const written: string[] = [];
  return {
    config,
    database,
    dependencies: {
      config,
      gateway: createScriptedGateway(options.script, gatewayCalls),
      pool: createRecordingPool(reservation, poolCalls),
      repository,
      storage: createMemoryStorage(written, options.failStorageFromIndex),
    },
    engine,
    gatewayCalls,
    poolCalls,
    repository,
    reservation,
    written,
  };
};

/**
 * Inserts and atomically claims one job so a worker can take it over.
 *
 * @param {WorkerHarness} harness - Harness owning the repository.
 * @param {string} id - Durable job identifier.
 * @returns {Promise<Job>} Claimed running job.
 */
const claimFixtureJob = async (
  harness: WorkerHarness,
  id: string,
): Promise<Job> => {
  const queued: Job = createJobFixture(id);
  await Effect.runPromise(harness.repository.createIfCapacity(queued, 10));
  const claimed: Option.Option<Job> = await Effect.runPromise(
    harness.repository.claim(id, "2026-08-14T12:05:00.000Z", 10),
  );
  if (Option.isNone(claimed)) {
    throw new Error("dispatcher fixture could not claim the job");
  }
  return claimed.value;
};

/**
 * Reads one durable job back, failing loudly when it disappeared.
 *
 * @param {WorkerHarness} harness - Harness owning the repository.
 * @param {string} id - Durable job identifier.
 * @returns {Promise<Job>} Current durable job.
 */
const readJob = async (harness: WorkerHarness, id: string): Promise<Job> => {
  const current: Option.Option<Job> = await Effect.runPromise(
    harness.repository.getById(id),
  );
  if (Option.isNone(current)) {
    throw new Error(`durable job ${id} disappeared`);
  }
  return current.value;
};

export type { GatewayScript, WorkerHarness };
export {
  claimFixtureJob,
  completedRemoteJob,
  createWorkerHarness,
  RemoteJobId,
  readJob,
};
