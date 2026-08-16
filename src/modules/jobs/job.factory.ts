import { JobStatus } from "@app/modules/jobs/job.constants";
import type { Job, JobCreateRequest } from "@app/modules/jobs/job.types";
import { computeJobCost } from "@app/modules/jobs/job.utils";
import { DateTime, Effect } from "effect";

/**
 * Reads the Effect clock as an ISO-8601 timestamp.
 *
 * @returns {Effect.Effect<string>} Current timestamp in UTC.
 */
const currentIsoTimestamp = (): Effect.Effect<string> =>
  DateTime.now.pipe(Effect.map(DateTime.formatIso));

/**
 * Creates a new durable queued job using the Effect clock.
 *
 * @param {JobCreateRequest} request - Fully validated generation request.
 * @returns {Effect.Effect<Job>} New queued job with deterministic timestamps.
 */
const createQueuedJob = (request: JobCreateRequest): Effect.Effect<Job> =>
  currentIsoTimestamp().pipe(
    Effect.map(
      (nowIso: string): Job => ({
        attempt: 0,
        cancelRequested: false,
        cost: computeJobCost(request),
        createdAt: nowIso,
        id: crypto.randomUUID(),
        request,
        status: JobStatus.queued,
        updatedAt: nowIso,
      }),
    ),
  );

export { createQueuedJob, currentIsoTimestamp };
