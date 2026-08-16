import { afterEach, describe, expect, test } from "bun:test";
import { processClaimedJob } from "@app/infrastructure/dispatcher/stages/dispatcher-worker.service";
import { EngineJobStatus } from "@app/infrastructure/engine/engine.constants";
import type { EngineJob } from "@app/infrastructure/engine/engine.types";
import type { Job, JobResult } from "@app/modules/jobs/job.types";
import {
  claimFixtureJob,
  completedRemoteJob,
  createWorkerHarness,
  RemoteJobId,
  readJob,
  type WorkerHarness,
} from "@test/fixtures/dispatcher-worker.fixture";
import { Effect } from "effect";

/** Harnesses opened by the running test. */
const OpenHarnesses: WorkerHarness[] = [];

/** Remote job still generating, so polling continues for another round. */
const RunningRemoteJob: EngineJob = {
  error: null,
  id: RemoteJobId,
  result: null,
  status: EngineJobStatus.running,
};

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

describe("sampling progress persistence", (): void => {
  test("stores progress reported while the job is still generating", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: {
        responses: [
          { ...RunningRemoteJob, progress: { completed: 7, total: 20 } },
          completedRemoteJob(),
        ],
      },
    });
    const job: Job = await claimFixtureJob(harness, "worker-progress");
    await Effect.runPromise(
      processClaimedJob(job, harness.reservation, harness.dependencies),
    );
    const results: readonly JobResult[] = await Effect.runPromise(
      harness.repository.listResults(job.id),
    );
    const settled: Job = await readJob(harness, job.id);
    // The counters survive the terminal transition, so a finished job still
    // shows how far it got.
    expect(settled.progressStep).toBe(7);
    expect(settled.progressSteps).toBe(20);
    expect(results).toHaveLength(1);
  });

  test("leaves progress untouched when the engine reports none", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: { responses: [RunningRemoteJob, completedRemoteJob()] },
    });
    const job: Job = await claimFixtureJob(harness, "worker-no-progress");
    await Effect.runPromise(
      processClaimedJob(job, harness.reservation, harness.dependencies),
    );
    const settled: Job = await readJob(harness, job.id);
    expect(settled.progressStep).toBeUndefined();
    expect(settled.progressSteps).toBeUndefined();
  });
});
