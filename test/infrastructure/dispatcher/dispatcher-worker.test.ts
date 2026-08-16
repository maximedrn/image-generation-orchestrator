import { afterEach, describe, expect, test } from "bun:test";
import { EngineUnavailableError } from "@app/core/errors/error.types";
import {
  DispatcherErrorCode,
  DispatcherErrorMessage,
} from "@app/infrastructure/dispatcher/dispatcher.constants";
import { processClaimedJob } from "@app/infrastructure/dispatcher/stages/dispatcher-worker.service";
import { EngineJobStatus } from "@app/infrastructure/engine/engine.constants";
import type { EngineJob } from "@app/infrastructure/engine/engine.types";
import { JobStatus, OutputFormat } from "@app/modules/jobs/job.constants";
import type { Job, JobResult } from "@app/modules/jobs/job.types";
import {
  claimFixtureJob,
  completedRemoteJob,
  createWorkerHarness,
  RemoteJobId,
  readJob,
  type WorkerHarness,
} from "@test/fixtures/dispatcher-worker.fixture";
import {
  TestFailureMessage,
  TestImagePayload,
} from "@test/fixtures/test.constants";
import { Effect } from "effect";

/** Harnesses opened by the running test, closed once it settles. */
const OpenHarnesses: WorkerHarness[] = [];

/** Remote job still generating, forcing one more polling iteration. */
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

describe("dispatcher worker lifecycle", (): void => {
  test("persists results and succeeds a completed generation", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: { responses: [RunningRemoteJob, completedRemoteJob()] },
    });
    const job: Job = await claimFixtureJob(harness, "worker-success");
    await Effect.runPromise(
      processClaimedJob(job, harness.reservation, harness.dependencies),
    );
    const settled: Job = await readJob(harness, job.id);
    const results: readonly JobResult[] = await Effect.runPromise(
      harness.repository.listResults(job.id),
    );
    expect(settled.status).toBe(JobStatus.succeeded);
    expect(settled.remoteJobId).toBeUndefined();
    expect(results).toHaveLength(1);
    expect(results[0]?.mimeType).toBe(`image/${OutputFormat.png}`);
    expect(harness.written).toHaveLength(1);
    // Two polls: one still generating, one terminal.
    expect(harness.gatewayCalls.poll).toBe(2);
    expect(harness.poolCalls.release).toBe(1);
  });

  test("requeues the job when submission fails inside the retry budget", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      maxAttempts: 3,
      script: {
        responses: [],
        submitError: new EngineUnavailableError({
          message: TestFailureMessage.engineDown,
        }),
      },
    });
    const job: Job = await claimFixtureJob(harness, "worker-retry");
    await Effect.runPromise(
      processClaimedJob(job, harness.reservation, harness.dependencies),
    );
    const settled: Job = await readJob(harness, job.id);
    expect(settled.status).toBe(JobStatus.queued);
    expect(settled.errorCode).toBeUndefined();
    expect(harness.poolCalls.failure).toBe(1);
    expect(harness.poolCalls.release).toBe(1);
  });

  test("fails the job once the submission retry budget is exhausted", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      maxAttempts: 1,
      script: {
        responses: [],
        submitError: new EngineUnavailableError({
          message: TestFailureMessage.engineDown,
        }),
      },
    });
    const job: Job = await claimFixtureJob(harness, "worker-exhausted");
    await Effect.runPromise(
      processClaimedJob(job, harness.reservation, harness.dependencies),
    );
    const settled: Job = await readJob(harness, job.id);
    expect(settled.status).toBe(JobStatus.failed);
    expect(settled.errorCode).toBe(DispatcherErrorCode.engine);
    expect(settled.errorMessage).toBe(
      DispatcherErrorMessage.engineRetryExhausted,
    );
  });

  test("records the upstream error code when the engine reports a failure", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: {
        responses: [
          {
            error: { code: "OUT_OF_MEMORY", message: "vram exhausted" },
            id: RemoteJobId,
            result: null,
            status: EngineJobStatus.failed,
          },
        ],
      },
    });
    const job: Job = await claimFixtureJob(harness, "worker-remote-failure");
    await Effect.runPromise(
      processClaimedJob(job, harness.reservation, harness.dependencies),
    );
    const settled: Job = await readJob(harness, job.id);
    expect(settled.status).toBe(JobStatus.failed);
    expect(settled.errorCode).toBe("OUT_OF_MEMORY");
    expect(settled.errorMessage).toBe("vram exhausted");
  });

  test("falls back to a stable code when the engine failure carries none", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: {
        responses: [
          {
            error: null,
            id: RemoteJobId,
            result: null,
            status: EngineJobStatus.failed,
          },
        ],
      },
    });
    const job: Job = await claimFixtureJob(harness, "worker-bare-failure");
    await Effect.runPromise(
      processClaimedJob(job, harness.reservation, harness.dependencies),
    );
    const settled: Job = await readJob(harness, job.id);
    expect(settled.errorCode).toBe(DispatcherErrorCode.remote);
    expect(settled.errorMessage).toBe(DispatcherErrorMessage.remoteFailed);
  });

  test("cancels the durable job when the engine reports a cancellation", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: {
        responses: [
          {
            error: null,
            id: RemoteJobId,
            result: null,
            status: EngineJobStatus.cancelled,
          },
        ],
      },
    });
    const job: Job = await claimFixtureJob(harness, "worker-cancelled");
    await Effect.runPromise(
      processClaimedJob(job, harness.reservation, harness.dependencies),
    );
    const settled: Job = await readJob(harness, job.id);
    expect(settled.status).toBe(JobStatus.cancelled);
  });

  test("fails the job when a completed generation carries no image", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: {
        responses: [
          {
            error: null,
            id: RemoteJobId,
            result: { images: [], outputFormat: OutputFormat.png },
            status: EngineJobStatus.succeeded,
          },
        ],
      },
    });
    const job: Job = await claimFixtureJob(harness, "worker-empty-result");
    await Effect.runPromise(
      processClaimedJob(job, harness.reservation, harness.dependencies),
    );
    const settled: Job = await readJob(harness, job.id);
    expect(settled.status).toBe(JobStatus.failed);
    expect(settled.errorCode).toBe(DispatcherErrorCode.storage);
  });

  test("cleans up partial files when a result batch cannot be written", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      failStorageFromIndex: 1,
      script: {
        responses: [
          {
            error: null,
            id: RemoteJobId,
            result: {
              images: [
                { base64: TestImagePayload.short, index: 0 },
                { base64: TestImagePayload.short, index: 1 },
              ],
              outputFormat: OutputFormat.png,
            },
            status: EngineJobStatus.succeeded,
          },
        ],
      },
    });
    const job: Job = await claimFixtureJob(harness, "worker-storage-failure");
    await Effect.runPromise(
      processClaimedJob(job, harness.reservation, harness.dependencies),
    );
    const settled: Job = await readJob(harness, job.id);
    const results: readonly JobResult[] = await Effect.runPromise(
      harness.repository.listResults(job.id),
    );
    expect(settled.status).toBe(JobStatus.failed);
    expect(settled.errorCode).toBe(DispatcherErrorCode.storage);
    expect(settled.errorMessage).toBe(DispatcherErrorMessage.storageFailed);
    // The image written before the failure must not survive as an orphan.
    expect(harness.written).toHaveLength(0);
    expect(results).toHaveLength(0);
  });

  test("cancels the remote job when the durable binding is no longer claimable", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: { responses: [completedRemoteJob()] },
    });
    const job: Job = await claimFixtureJob(harness, "worker-not-bindable");
    // Taking the job out of `running` makes bindRemote return none.
    await Effect.runPromise(
      harness.repository.transition({
        changes: {},
        from: JobStatus.running,
        id: job.id,
        to: JobStatus.cancelled,
      }),
    );
    await Effect.runPromise(
      processClaimedJob(job, harness.reservation, harness.dependencies),
    );
    expect(harness.gatewayCalls.submit).toBe(1);
    // Remote work that cannot be bound is cancelled instead of being orphaned.
    expect(harness.gatewayCalls.cancel).toBe(1);
    expect(harness.gatewayCalls.poll).toBe(0);
    expect(harness.poolCalls.release).toBe(1);
  });

  test("asks the engine to cancel once a cancellation was requested", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: {
        responses: [
          {
            error: null,
            id: RemoteJobId,
            result: null,
            status: EngineJobStatus.cancelled,
          },
        ],
      },
    });
    const job: Job = await claimFixtureJob(harness, "worker-cancel-requested");
    await Effect.runPromise(harness.repository.requestCancellation(job.id));
    await Effect.runPromise(
      processClaimedJob(job, harness.reservation, harness.dependencies),
    );
    const settled: Job = await readJob(harness, job.id);
    expect(settled.status).toBe(JobStatus.cancelled);
    // The polling loop routes to cancel, never to poll, once asked to stop.
    expect(harness.gatewayCalls.cancel).toBe(1);
    expect(harness.gatewayCalls.poll).toBe(0);
  });
});
