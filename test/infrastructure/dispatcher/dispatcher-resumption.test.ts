import { afterEach, describe, expect, test } from "bun:test";
import { DatabaseError, StorageError } from "@app/core/errors/error.types";
import {
  processClaimedJob,
  resumeClaimedJob,
} from "@app/infrastructure/dispatcher/stages/dispatcher-worker.service";
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

/** Harnesses opened by the running test. */
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

afterEach((): void => {
  for (const harness of OpenHarnesses.splice(0)) {
    harness.database.client.close();
  }
});

describe("dispatcher recovery resumption", (): void => {
  test("resumes polling an already submitted remote job", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: { responses: [completedRemoteJob()] },
    });
    const job: Job = await claimFixtureJob(harness, "resume-success");
    await Effect.runPromise(
      harness.repository.bindRemote(
        job.id,
        harness.engine.id,
        RemoteJobId,
        "2026-08-14T12:20:00.000Z",
      ),
    );
    await Effect.runPromise(
      resumeClaimedJob(
        job,
        harness.reservation,
        RemoteJobId,
        harness.dependencies,
      ),
    );
    expect(harness.gatewayCalls.poll).toBe(1);
    expect(harness.poolCalls.release).toBe(1);
  });

  test("defers resumption to recovery when durable storage is unavailable", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: { responses: [completedRemoteJob()] },
    });
    const job: Job = await claimFixtureJob(harness, "resume-db-loss");
    await Effect.runPromise(
      resumeClaimedJob(job, harness.reservation, RemoteJobId, {
        ...harness.dependencies,
        repository: {
          ...harness.repository,
          renewLease: (): Effect.Effect<boolean, DatabaseError> =>
            Effect.fail(
              new DatabaseError({ message: TestFailureMessage.databaseGone }),
            ),
        },
      }),
    );
    // Contained, and the engine slot is handed back either way.
    expect(harness.poolCalls.release).toBe(1);
  });

  test("ignores a storage failure while cleaning up published results", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: { responses: [completedRemoteJob()] },
    });
    const job: Job = await claimFixtureJob(harness, "cleanup-failure");
    await Effect.runPromise(
      processClaimedJob(job, harness.reservation, {
        ...harness.dependencies,
        repository: {
          ...harness.repository,
          saveResults: (): Effect.Effect<void, DatabaseError> =>
            Effect.fail(
              new DatabaseError({ message: TestFailureMessage.databaseLocked }),
            ),
        },
        storage: {
          ...harness.dependencies.storage,
          remove: (): Effect.Effect<void, StorageError> =>
            Effect.fail(new StorageError({ message: "disk is read-only" })),
        },
      }),
    );
    // The storage failure must not mask the original persistence failure.
    expect(harness.poolCalls.release).toBe(1);
  });
});

describe("durable binding retries", (): void => {
  test("binds on a later attempt when storage recovers within the lease", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: { responses: [completedRemoteJob()] },
    });
    const job: Job = await claimFixtureJob(harness, "bind-recovers");
    let attempts: number = 0;
    const repository: JobRepositoryShape = {
      ...harness.repository,
      bindRemote: (
        id: string,
        engineId: string,
        remoteJobId: string,
        leaseUntil: string,
      ): Effect.Effect<Option.Option<Job>, DatabaseError> => {
        attempts += 1;
        return attempts === 1
          ? Effect.fail(new DatabaseError({ message: "database is busy" }))
          : harness.repository.bindRemote(
              id,
              engineId,
              remoteJobId,
              leaseUntil,
            );
      },
    };
    await Effect.runPromise(
      processClaimedJob(job, harness.reservation, {
        ...harness.dependencies,
        config: {
          ...harness.config,
          queue: { ...harness.config.queue, recoveryIntervalSeconds: 0 },
        },
        repository,
      }),
    );
    expect(attempts).toBeGreaterThan(1);
    // The retry succeeded, so the remote job was polled rather than cancelled.
    expect(harness.gatewayCalls.poll).toBe(1);
    expect(harness.gatewayCalls.cancel).toBe(0);
  });
});
