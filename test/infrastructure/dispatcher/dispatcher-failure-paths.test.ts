import { afterEach, describe, expect, test } from "bun:test";
import {
  DatabaseError,
  EngineUnavailableError,
} from "@app/core/errors/error.types";
import type { DispatcherWorkerDependencies } from "@app/infrastructure/dispatcher/dispatcher.types";
import { pollRemoteJob } from "@app/infrastructure/dispatcher/stages/dispatcher-poll.service";
import { cancelUnboundRemoteJob } from "@app/infrastructure/dispatcher/stages/dispatcher-submission.service";
import { processClaimedJob } from "@app/infrastructure/dispatcher/stages/dispatcher-worker.service";
import type { EngineGatewayError } from "@app/infrastructure/engine/engine.interface";
import type { EngineJob } from "@app/infrastructure/engine/engine.types";
import { JobStatus } from "@app/modules/jobs/job.constants";
import type { JobRepositoryShape } from "@app/modules/jobs/job.interface";
import type { Job } from "@app/modules/jobs/job.types";
import {
  claimFixtureJob,
  completedRemoteJob,
  createWorkerHarness,
  RemoteJobId,
  type WorkerHarness,
} from "@test/fixtures/dispatcher-worker.fixture";
import { TestFailureMessage } from "@test/fixtures/test.constants";
import { Effect, Option } from "effect";

/** Harnesses opened by the running test, closed once it settles. */
const OpenHarnesses: WorkerHarness[] = [];

/**
 * Opens one tracked harness so the database is always closed afterwards.
 *
 * @param {Parameters<typeof createWorkerHarness>[0]} options - Scenario options.
 * @returns {WorkerHarness} Tracked worker harness.
 */
const openHarness = (
  options: Parameters<typeof createWorkerHarness>[0],
): WorkerHarness => {
  const harness: WorkerHarness = createWorkerHarness(options);
  OpenHarnesses.push(harness);
  return harness;
};

/**
 * Replaces the harness gateway so every upstream call fails.
 *
 * @param {WorkerHarness} harness - Harness to derive dependencies from.
 * @returns {DispatcherWorkerDependencies} Dependencies with a failing gateway.
 */
const withFailingGateway = (
  harness: WorkerHarness,
): DispatcherWorkerDependencies => ({
  ...harness.dependencies,
  gateway: {
    ...harness.dependencies.gateway,
    cancel: (): Effect.Effect<EngineJob, EngineGatewayError> =>
      Effect.fail(new EngineUnavailableError({ message: "engine is gone" })),
    poll: (): Effect.Effect<EngineJob, EngineGatewayError> =>
      Effect.fail(new EngineUnavailableError({ message: "engine is gone" })),
  },
});

afterEach((): void => {
  for (const harness of OpenHarnesses.splice(0)) {
    harness.database.client.close();
  }
});

describe("dispatcher polling gives up safely", (): void => {
  test("stops polling once the engine circuit threshold is reached", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: { responses: [completedRemoteJob()] },
    });
    const job: Job = await claimFixtureJob(harness, "poll-threshold");
    await Effect.runPromise(
      harness.repository.bindRemote(
        job.id,
        harness.engine.id,
        RemoteJobId,
        "2026-08-14T12:10:00.000Z",
      ),
    );
    await Effect.runPromise(
      pollRemoteJob(
        job,
        {
          consecutiveFailures: 0,
          engine: harness.engine,
          remoteJobId: RemoteJobId,
        },
        withFailingGateway(harness),
      ),
    );
    // The job stays running: lease recovery, not this worker, owns it now.
    const current: Option.Option<Job> = await Effect.runPromise(
      harness.repository.getById(job.id),
    );
    expect(Option.isSome(current)).toBe(true);
    if (Option.isSome(current)) {
      expect(current.value.status).toBe(JobStatus.running);
    }
    // One failure recorded per attempt, up to the configured threshold.
    expect(harness.poolCalls.failure).toBe(
      harness.engine.circuitBreaker.failureThreshold,
    );
  });

  test("stops polling when the durable job disappeared", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: { responses: [completedRemoteJob()] },
    });
    await Effect.runPromise(
      pollRemoteJob(
        {
          ...(await claimFixtureJob(harness, "poll-gone")),
          id: "never-existed",
        },
        {
          consecutiveFailures: 0,
          engine: harness.engine,
          remoteJobId: RemoteJobId,
        },
        harness.dependencies,
      ),
    );
    expect(harness.gatewayCalls.poll).toBe(0);
  });

  test("stops polling when the job left the running state", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: { responses: [completedRemoteJob()] },
    });
    const job: Job = await claimFixtureJob(harness, "poll-not-running");
    await Effect.runPromise(
      harness.repository.transition({
        changes: {},
        from: JobStatus.running,
        id: job.id,
        to: JobStatus.cancelled,
      }),
    );
    await Effect.runPromise(
      pollRemoteJob(
        job,
        {
          consecutiveFailures: 0,
          engine: harness.engine,
          remoteJobId: RemoteJobId,
        },
        harness.dependencies,
      ),
    );
    expect(harness.gatewayCalls.poll).toBe(0);
  });
});

describe("dispatcher submission failure containment", (): void => {
  test("records a scheduler failure when unbound remote cancellation fails", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: { responses: [completedRemoteJob()] },
    });
    await Effect.runPromise(
      cancelUnboundRemoteJob(
        harness.reservation,
        RemoteJobId,
        withFailingGateway(harness),
      ),
    );
    expect(harness.poolCalls.failure).toBe(1);
    expect(harness.poolCalls.success).toBe(0);
  });

  test("gives the engine slot back when binding cannot be persisted", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: { responses: [completedRemoteJob()] },
    });
    const job: Job = await claimFixtureJob(harness, "bind-failure");
    const repository: JobRepositoryShape = {
      ...harness.repository,
      bindRemote: (): Effect.Effect<Option.Option<Job>, DatabaseError> =>
        Effect.fail(
          new DatabaseError({ message: TestFailureMessage.databaseLocked }),
        ),
    };
    await Effect.runPromise(
      processClaimedJob(job, harness.reservation, {
        ...harness.dependencies,
        config: {
          ...harness.config,
          queue: {
            ...harness.config.queue,
            leaseSeconds: 0,
            recoveryIntervalSeconds: 0,
          },
        },
        repository,
      }),
    );
    expect(harness.gatewayCalls.submit).toBe(1);
    // The orphan remote job is cancelled and never polled.
    expect(harness.gatewayCalls.cancel).toBe(1);
    expect(harness.gatewayCalls.poll).toBe(0);
    // Crucially the reservation is released instead of being pinned forever.
    expect(harness.poolCalls.release).toBe(1);
  });
});

describe("dispatcher persistence failures stay contained", (): void => {
  test("logs instead of throwing when the retry transition cannot be written", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: {
        responses: [],
        submitError: new EngineUnavailableError({
          message: TestFailureMessage.engineDown,
        }),
      },
    });
    const job: Job = await claimFixtureJob(harness, "retry-write-failure");
    const repository: JobRepositoryShape = {
      ...harness.repository,
      transition: (): Effect.Effect<Option.Option<Job>, DatabaseError> =>
        Effect.fail(
          new DatabaseError({ message: TestFailureMessage.databaseLocked }),
        ),
    };
    // A failing transition must not escape: the worker owns a reservation.
    await Effect.runPromise(
      processClaimedJob(job, harness.reservation, {
        ...harness.dependencies,
        repository,
      }),
    );
    expect(harness.poolCalls.failure).toBe(1);
    expect(harness.poolCalls.release).toBe(1);
  });

  test("defers to lease recovery when polling loses durable storage", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: { responses: [completedRemoteJob()] },
    });
    const job: Job = await claimFixtureJob(harness, "poll-database-loss");
    const repository: JobRepositoryShape = {
      ...harness.repository,
      getById: (): Effect.Effect<Option.Option<Job>, DatabaseError> =>
        Effect.fail(
          new DatabaseError({ message: TestFailureMessage.databaseGone }),
        ),
    };
    await Effect.runPromise(
      processClaimedJob(job, harness.reservation, {
        ...harness.dependencies,
        repository,
      }),
    );
    // Contained: the reservation is released rather than leaked on failure.
    expect(harness.poolCalls.release).toBe(1);
  });
});
