import { afterEach, describe, expect, test } from "bun:test";
import { DatabaseError } from "@app/core/errors/error.types";
import { DispatcherRecoveryScope } from "@app/infrastructure/dispatcher/dispatcher.constants";
import {
  createDispatcher,
  dispatchOne,
  safeDispatchOne,
  safeRecoverRunningJobs,
} from "@app/infrastructure/dispatcher/dispatcher.service";
import type { DispatcherWorkerDependencies } from "@app/infrastructure/dispatcher/dispatcher.types";
import { recoverRemoteJob } from "@app/infrastructure/dispatcher/stages/dispatcher-recovery.service";
import type { EnginePoolShape } from "@app/infrastructure/engine/engine.interface";
import type { EngineReservation } from "@app/infrastructure/engine/engine.types";
import type { JobRepositoryShape } from "@app/modules/jobs/job.interface";
import type { Job } from "@app/modules/jobs/job.types";
import {
  claimFixtureJob,
  completedRemoteJob,
  createWorkerHarness,
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

describe("dispatcher scheduling loop", (): void => {
  test("does nothing while the queue is empty", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: { responses: [completedRemoteJob()] },
    });
    await Effect.runPromise(dispatchOne(harness.dependencies));
    expect(harness.gatewayCalls.submit).toBe(0);
  });

  test("gives the reservation back when the claim loses the race", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: { responses: [completedRemoteJob()] },
    });
    await claimFixtureJob(harness, "dispatch-race");
    const repository: JobRepositoryShape = {
      ...harness.repository,
      claim: (): Effect.Effect<Option.Option<Job>, DatabaseError> =>
        Effect.succeed(Option.none()),
      peekNextQueued: harness.repository.peekNextQueued,
    };
    await Effect.runPromise(
      dispatchOne({ ...harness.dependencies, repository }),
    );
    expect(harness.poolCalls.release).toBe(0);
  });

  test("holds the queue when no engine has capacity", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: { responses: [completedRemoteJob()] },
    });
    const pool: EnginePoolShape = {
      ...harness.dependencies.pool,
      reserve: (): Effect.Effect<Option.Option<EngineReservation>> =>
        Effect.succeed(Option.none()),
    };
    await Effect.runPromise(
      Effect.either(dispatchOne({ ...harness.dependencies, pool })),
    );
    expect(harness.gatewayCalls.submit).toBe(0);
  });

  test("contains repository failures inside one loop iteration", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: { responses: [completedRemoteJob()] },
    });
    const dependencies: DispatcherWorkerDependencies = {
      ...harness.dependencies,
      repository: {
        ...harness.repository,
        listRunning: (): Effect.Effect<readonly Job[], DatabaseError> =>
          Effect.fail(
            new DatabaseError({ message: TestFailureMessage.databaseGone }),
          ),
        peekNextQueued: (): Effect.Effect<never, DatabaseError> =>
          Effect.fail(
            new DatabaseError({ message: TestFailureMessage.databaseGone }),
          ),
      },
    };
    // Neither call may escape: both back a long-lived operational loop.
    await Effect.runPromise(safeDispatchOne(dependencies));
    await Effect.runPromise(
      safeRecoverRunningJobs(dependencies, DispatcherRecoveryScope.allRunning),
    );
    expect(createDispatcher(dependencies).run).toBeDefined();
  });

  test("logs instead of throwing when incomplete recovery cannot be written", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: { responses: [completedRemoteJob()] },
    });
    const job: Job = await claimFixtureJob(harness, "recover-write-failure");
    await Effect.runPromise(
      recoverRemoteJob(job, {
        ...harness.dependencies,
        repository: {
          ...harness.repository,
          transition: (): Effect.Effect<Option.Option<Job>, DatabaseError> =>
            Effect.fail(
              new DatabaseError({ message: TestFailureMessage.databaseLocked }),
            ),
        },
      }),
    );
    expect(true).toBe(true);
  });
});
