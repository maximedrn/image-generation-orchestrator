import { afterEach, describe, expect, test } from "bun:test";
import {
  EngineBusyError,
  EngineJobNotFoundError,
} from "@app/core/errors/error.types";
import { pollRemoteJob } from "@app/infrastructure/dispatcher/stages/dispatcher-poll.service";
import { EngineJobStatus } from "@app/infrastructure/engine/engine.constants";
import type { EngineGatewayError } from "@app/infrastructure/engine/engine.interface";
import type { EngineJob } from "@app/infrastructure/engine/engine.types";
import { JobStatus } from "@app/modules/jobs/job.constants";
import type { Job } from "@app/modules/jobs/job.types";
import {
  claimFixtureJob,
  completedRemoteJob,
  createWorkerHarness,
  RemoteJobId,
  type WorkerHarness,
} from "@test/fixtures/dispatcher-worker.fixture";
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

describe("engine declining a cancellation", (): void => {
  test("keeps polling without faulting an engine that cannot interrupt yet", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: { responses: [completedRemoteJob()] },
    });
    const job: Job = await claimFixtureJob(harness, "cancel-too-early");
    await Effect.runPromise(
      harness.repository.bindRemote(
        job.id,
        harness.engine.id,
        RemoteJobId,
        "2026-08-14T12:40:00.000Z",
      ),
    );
    await Effect.runPromise(harness.repository.requestCancellation(job.id));
    let refusals = 0;
    await Effect.runPromise(
      pollRemoteJob(
        job,
        {
          consecutiveFailures: 0,
          engine: harness.engine,
          remoteJobId: RemoteJobId,
        },
        {
          ...harness.dependencies,
          gateway: {
            ...harness.dependencies.gateway,
            cancel: (): Effect.Effect<EngineJob, EngineGatewayError> => {
              refusals += 1;
              // Refuse twice, as a mid-generation engine would, then comply.
              return refusals <= 2
                ? Effect.fail(
                    new EngineBusyError({
                      engineId: harness.engine.id,
                      message: "engine cannot honour the request yet",
                    }),
                  )
                : Effect.succeed({
                    error: null,
                    id: RemoteJobId,
                    result: null,
                    status: EngineJobStatus.cancelled,
                  });
            },
          },
        },
      ),
    );
    const current: Option.Option<Job> = await Effect.runPromise(
      harness.repository.getById(job.id),
    );
    expect(refusals).toBe(3);
    expect(Option.isSome(current)).toBe(true);
    if (Option.isSome(current)) {
      expect(current.value.status).toBe(JobStatus.cancelled);
    }
    // A polite refusal is not an outage: the breaker must stay closed.
    expect(harness.poolCalls.failure).toBe(0);
  });

  test("honours a cancellation when the engine forgot the remote job", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: { responses: [completedRemoteJob()] },
    });
    const job: Job = await claimFixtureJob(harness, "cancel-remote-lost");
    await Effect.runPromise(
      harness.repository.bindRemote(
        job.id,
        harness.engine.id,
        RemoteJobId,
        "2026-08-14T12:45:00.000Z",
      ),
    );
    await Effect.runPromise(harness.repository.requestCancellation(job.id));
    const cancelled: Option.Option<Job> = await Effect.runPromise(
      harness.repository.getById(job.id),
    );
    if (Option.isNone(cancelled)) throw new Error("fixture job disappeared");
    await Effect.runPromise(
      pollRemoteJob(
        cancelled.value,
        {
          consecutiveFailures: 0,
          engine: harness.engine,
          remoteJobId: RemoteJobId,
        },
        {
          ...harness.dependencies,
          gateway: {
            ...harness.dependencies.gateway,
            cancel: (): Effect.Effect<EngineJob, EngineGatewayError> =>
              Effect.fail(
                new EngineJobNotFoundError({
                  engineId: harness.engine.id,
                  message: "engine no longer knows this remote job",
                }),
              ),
          },
        },
      ),
    );
    const settled: Option.Option<Job> = await Effect.runPromise(
      harness.repository.getById(job.id),
    );
    expect(Option.isSome(settled)).toBe(true);
    if (Option.isSome(settled)) {
      // Never requeued: the caller asked for this work to stop.
      expect(settled.value.status).toBe(JobStatus.cancelled);
    }
  });
});
