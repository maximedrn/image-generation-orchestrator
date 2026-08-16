import { afterEach, describe, expect, test } from "bun:test";
import { DispatcherRecoveryScope } from "@app/infrastructure/dispatcher/dispatcher.constants";
import {
  recoverRemoteJob,
  recoverRunningJobs,
  shouldRecoverJob,
} from "@app/infrastructure/dispatcher/stages/dispatcher-recovery.service";
import type { EnginePoolShape } from "@app/infrastructure/engine/engine.interface";
import type { EngineReservation } from "@app/infrastructure/engine/engine.types";
import { JobStatus } from "@app/modules/jobs/job.constants";
import type { Job } from "@app/modules/jobs/job.types";
import {
  claimFixtureJob,
  completedRemoteJob,
  createWorkerHarness,
  RemoteJobId,
  type WorkerHarness,
} from "@test/fixtures/dispatcher-worker.fixture";
import { createJobFixture } from "@test/fixtures/platform.fixture";
import { TestInstant } from "@test/fixtures/test.constants";
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

afterEach((): void => {
  for (const harness of OpenHarnesses.splice(0)) {
    harness.database.client.close();
  }
});

describe("dispatcher recovery scope", (): void => {
  test("recovers every running job at startup but only expired leases later", (): void => {
    const leased: Job = {
      ...createJobFixture("recover-scope"),
      leaseUntil: "2999-01-01T00:00:00.000Z",
    };
    expect(
      shouldRecoverJob(
        leased,
        TestInstant.created,
        DispatcherRecoveryScope.allRunning,
      ),
    ).toBe(true);
    expect(
      shouldRecoverJob(
        leased,
        TestInstant.created,
        DispatcherRecoveryScope.expiredOnly,
      ),
    ).toBe(false);
    expect(
      shouldRecoverJob(
        createJobFixture("recover-scope-no-lease"),
        TestInstant.created,
        DispatcherRecoveryScope.expiredOnly,
      ),
    ).toBe(true);
  });

  test("returns a running job with no remote metadata to the retry policy", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: { responses: [completedRemoteJob()] },
    });
    const job: Job = await claimFixtureJob(harness, "recover-incomplete");
    await Effect.runPromise(recoverRemoteJob(job, harness.dependencies));
    const current: Option.Option<Job> = await Effect.runPromise(
      harness.repository.getById(job.id),
    );
    expect(Option.isSome(current)).toBe(true);
    if (Option.isSome(current)) {
      expect(current.value.status).toBe(JobStatus.queued);
    }
  });

  test("defers recovery when the scheduler cannot hand back the engine", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: { responses: [completedRemoteJob()] },
    });
    const job: Job = await claimFixtureJob(harness, "recover-deferred");
    const bound: Option.Option<Job> = await Effect.runPromise(
      harness.repository.bindRemote(
        job.id,
        harness.engine.id,
        RemoteJobId,
        "2020-01-01T00:00:00.000Z",
      ),
    );
    expect(Option.isSome(bound)).toBe(true);
    const pool: EnginePoolShape = {
      ...harness.dependencies.pool,
      reserveById: (): Effect.Effect<Option.Option<EngineReservation>> =>
        Effect.succeed(Option.none()),
    };
    await Effect.runPromise(
      recoverRunningJobs(
        { ...harness.dependencies, pool },
        DispatcherRecoveryScope.expiredOnly,
      ),
    );
    // Nothing was resumed, and the job is still owned by durable storage.
    expect(harness.gatewayCalls.poll).toBe(0);
    const current: Option.Option<Job> = await Effect.runPromise(
      harness.repository.getById(job.id),
    );
    expect(Option.isSome(current)).toBe(true);
    if (Option.isSome(current)) {
      expect(current.value.status).toBe(JobStatus.running);
    }
  });
});
