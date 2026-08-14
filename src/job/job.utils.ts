import type { JobCreateRequest, JobStatus } from "@app/job/job.types.js";
import { JOB_STATUS } from "@app/job/job.constants.js";

/** Allowed state transitions for durable jobs. */
const JOB_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  [JOB_STATUS.CANCELLED]: [],
  [JOB_STATUS.FAILED]: [],
  [JOB_STATUS.QUEUED]: [JOB_STATUS.CANCELLED, JOB_STATUS.RUNNING],
  [JOB_STATUS.RUNNING]: [
    JOB_STATUS.CANCELLED,
    JOB_STATUS.FAILED,
    JOB_STATUS.QUEUED,
    JOB_STATUS.SUCCEEDED,
  ],
  [JOB_STATUS.SUCCEEDED]: [],
};

/**
 * Computes the deterministic admission cost of a request.
 *
 * @param request - (JobCreateRequest) Fully decoded request.
 * @returns (number) Width × height × steps × image count.
 */
const computeJobCost = (request: JobCreateRequest): number =>
  request.width * request.height * request.steps * request.count;

/**
 * Tests whether a state transition belongs to the explicit job state machine.
 *
 * @param from - (JobStatus) Current persisted status.
 * @param to - (JobStatus) Requested next status.
 * @returns (boolean) `true` only when the transition is permitted.
 */
const canTransitionJob = (from: JobStatus, to: JobStatus): boolean =>
  JOB_TRANSITIONS[from].includes(to);

export { canTransitionJob, computeJobCost, JOB_TRANSITIONS };
