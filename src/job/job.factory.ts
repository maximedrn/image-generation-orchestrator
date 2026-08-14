import { Clock, Effect } from "effect";

import { JOB_STATUS } from "@app/job/job.constants.js";
import type { Job, JobCreateRequest } from "@app/job/job.types.js";
import { computeJobCost } from "@app/job/job.utils.js";

/**
 * Creates a new durable queued job using the Effect clock.
 *
 * @param request - (JobCreateRequest) Fully validated generation request.
 * @returns (Effect.Effect<Job>) New queued job with deterministic timestamps.
 */
const createQueuedJob = (request: JobCreateRequest): Effect.Effect<Job> =>
  Clock.currentTimeMillis.pipe(
    Effect.map((epochMs: number): Job => {
      const nowIso: string = new Date(epochMs).toISOString();
      return {
        attempt: 0,
        cancelRequested: false,
        cost: computeJobCost(request),
        createdAt: nowIso,
        id: crypto.randomUUID(),
        request,
        status: JOB_STATUS.QUEUED,
        updatedAt: nowIso,
      };
    }),
  );

export { createQueuedJob };
