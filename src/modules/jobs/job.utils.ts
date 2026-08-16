import { JobStatus } from "@app/modules/jobs/job.constants";
import type {
  JobCreateRequest,
  JobStatusValue,
} from "@app/modules/jobs/job.types";

/** Allowed state transitions for durable jobs. */
const JobTransitions: Readonly<
  Record<JobStatusValue, readonly JobStatusValue[]>
> = {
  [JobStatus.cancelled]: [],
  [JobStatus.failed]: [],
  [JobStatus.queued]: [JobStatus.cancelled, JobStatus.running],
  [JobStatus.running]: [
    JobStatus.cancelled,
    JobStatus.failed,
    JobStatus.queued,
    JobStatus.succeeded,
  ],
  [JobStatus.succeeded]: [],
};

/**
 * Computes the deterministic admission cost of a request.
 *
 * @param {JobCreateRequest} request - Fully decoded request.
 * @returns {number} Width × height × steps × image count.
 */
const computeJobCost = (request: JobCreateRequest): number =>
  request.width * request.height * request.steps * request.count;

/**
 * Tests whether a state transition belongs to the explicit job state machine.
 *
 * @param {JobStatusValue} from - Current persisted status.
 * @param {JobStatusValue} to - Requested next status.
 * @returns {boolean} `true` only when the transition is permitted.
 */
const canTransitionJob = (from: JobStatusValue, to: JobStatusValue): boolean =>
  JobTransitions[from].includes(to);

export { canTransitionJob, computeJobCost, JobTransitions };
