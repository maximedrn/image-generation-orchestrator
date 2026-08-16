import { ConfigService } from "@app/core/config/config.service";
import type { PlatformConfig } from "@app/core/config/config.types";
import {
  type DatabaseError,
  JobNotCancellableError,
  JobNotFoundError,
  QueueFullError,
} from "@app/core/errors/error.types";
import { resultPath, resultUrl } from "@app/core/http/http-url.helpers";
import { ServiceTag } from "@app/core/runtime/service.constants";
import { RateLimiter } from "@app/core/security/rate-limit.service";
import type { RateLimiterShape } from "@app/core/security/security.interface";
import { JobRepository } from "@app/infrastructure/database/repository/job-repository.service";
import {
  JobAdmission,
  JobMessage,
  JobPublicErrorCode,
  JobStatus,
} from "@app/modules/jobs/job.constants";
import { createQueuedJob } from "@app/modules/jobs/job.factory";
import { validateJobLimits } from "@app/modules/jobs/job.helpers";
import type {
  JobRepositoryShape,
  JobServiceError,
  JobServiceShape,
} from "@app/modules/jobs/job.interface";
import type {
  Job,
  JobCreateRequest,
  JobResponse,
  JobResult,
} from "@app/modules/jobs/job.types";
import { Duration, Effect, Option } from "effect";

/**
 * Converts a domain job plus result metadata into the stable public response.
 *
 * @param {Job} job - Durable job.
 * @param {readonly JobResult[]} results - Persisted result metadata.
 * @returns {JobResponse} Public API representation.
 */
const toJobResponse = (
  job: Job,
  results: readonly JobResult[],
): JobResponse => {
  const succeeded: boolean = job.status === JobStatus.succeeded;
  return {
    cancelRequested: job.cancelRequested,
    createdAt: job.createdAt,
    error:
      job.status === JobStatus.failed
        ? {
            code: JobPublicErrorCode.generationFailed,
            message: JobMessage.generationFailed,
          }
        : null,
    id: job.id,
    request: job.request,
    resultUrls: succeeded
      ? results.map((result: JobResult): string =>
          resultUrl(job.id, result.index),
        )
      : [],
    startedAt: job.startedAt ?? null,
    status: job.status,
    updatedAt: job.updatedAt,
  };
};

/**
 * Resolves a required job or fails with an explicit not-found error.
 *
 * @param {JobRepositoryShape} repository - Persistence adapter.
 * @param {string} id - Job identifier.
 * @returns {Effect.Effect<Job, DatabaseError | JobNotFoundError>} Existing job.
 */
const requireJob = (
  repository: JobRepositoryShape,
  id: string,
): Effect.Effect<Job, DatabaseError | JobNotFoundError> =>
  repository
    .getById(id)
    .pipe(
      Effect.flatMap(
        (
          jobOption: Option.Option<Job>,
        ): Effect.Effect<Job, JobNotFoundError> =>
          Option.isNone(jobOption)
            ? Effect.fail(new JobNotFoundError({ id }))
            : Effect.succeed(jobOption.value),
      ),
    );

/**
 * Reads one job and its result metadata.
 *
 * @param {JobRepositoryShape} repository - Persistence adapter.
 * @param {string} id - Job identifier.
 * @returns {Effect.Effect<JobResponse, JobServiceError>} Public job response.
 */
const getJobResponse = (
  repository: JobRepositoryShape,
  id: string,
): Effect.Effect<JobResponse, JobServiceError> =>
  Effect.gen(function* getJobResponseEffect() {
    const job: Job = yield* requireJob(repository, id);
    const results: readonly JobResult[] = yield* repository.listResults(id);
    return toJobResponse(job, results);
  });

/**
 * Cancels a queued job or requests remote cancellation for a running job.
 *
 * @param {JobRepositoryShape} repository - Persistence adapter.
 * @param {string} id - Job identifier.
 * @returns {Effect.Effect<JobResponse, JobServiceError>} Updated job response.
 */
const cancelJob = (
  repository: JobRepositoryShape,
  id: string,
): Effect.Effect<JobResponse, JobServiceError> =>
  Effect.gen(function* cancelJobEffect() {
    const cancelledOption: Option.Option<Job> =
      yield* repository.requestCancellation(id);
    if (Option.isSome(cancelledOption)) {
      return toJobResponse(cancelledOption.value, []);
    }
    const current: Job = yield* requireJob(repository, id);
    return yield* Effect.fail(
      new JobNotCancellableError({
        id: current.id,
        message: `${JobMessage.alreadyTerminal}: ${current.id}`,
      }),
    );
  });

/**
 * Reads one result descriptor only after the parent job is durably successful.
 *
 * @param {JobRepositoryShape} repository - Persistence adapter.
 * @param {string} id - Job identifier.
 * @param {number} index - Result index.
 * @returns {Effect.Effect<JobResult, DatabaseError | JobNotFoundError>} Result metadata.
 */
const getJobResult = (
  repository: JobRepositoryShape,
  id: string,
  index: number,
): Effect.Effect<JobResult, DatabaseError | JobNotFoundError> =>
  requireJob(repository, id).pipe(
    Effect.flatMap(
      (
        job: Job,
      ): Effect.Effect<
        Option.Option<JobResult>,
        DatabaseError | JobNotFoundError
      > =>
        job.status === JobStatus.succeeded
          ? repository.getResult(id, index)
          : Effect.fail(new JobNotFoundError({ id: resultPath(id, index) })),
    ),
    Effect.flatMap(
      (
        resultOption: Option.Option<JobResult>,
      ): Effect.Effect<JobResult, JobNotFoundError> =>
        Option.isNone(resultOption)
          ? Effect.fail(new JobNotFoundError({ id: resultPath(id, index) }))
          : Effect.succeed(resultOption.value),
    ),
  );

/**
 * Decodes, validates, rate-limits and durably admits one generation request.
 *
 * @param {PlatformConfig} config - Runtime guardrails.
 * @param {JobRepositoryShape} repository - Persistence adapter.
 * @param {RateLimiterShape} rateLimiter - Admission rate limiter.
 * @param {JobCreateRequest} request - Request decoded by the transport boundary.
 * @param {string} clientKey - Rate-limit key.
 * @returns {Effect.Effect<JobResponse, JobServiceError>} Accepted job response.
 */
const submitJob = (
  config: PlatformConfig,
  repository: JobRepositoryShape,
  rateLimiter: RateLimiterShape,
  request: JobCreateRequest,
  clientKey: string,
): Effect.Effect<JobResponse, JobServiceError> =>
  Effect.gen(function* submitJobEffect() {
    yield* rateLimiter.consume(clientKey);
    yield* validateJobLimits(request, config);
    const job: Job = yield* createQueuedJob(request);
    const accepted: boolean = yield* repository.createIfCapacity(
      job,
      config.queue.maxQueuedJobs,
    );
    if (!accepted) {
      const retryAfterSeconds: number = Math.max(
        JobAdmission.minimumRetryAfterSeconds,
        Math.ceil(
          Duration.toSeconds(Duration.millis(config.queue.pollIntervalMs)),
        ),
      );
      return yield* Effect.fail(
        new QueueFullError({
          message: JobMessage.queueFull,
          retryAfterSeconds,
        }),
      );
    }
    return toJobResponse(job, []);
  });

/**
 * Builds the job application service from explicit Effect dependencies.
 *
 * @param {PlatformConfig} config - Resolved application configuration.
 * @param {JobRepositoryShape} repository - Durable persistence port.
 * @param {RateLimiterShape} rateLimiter - Bounded local rate limiter.
 * @returns {JobServiceShape} Application service implementation.
 */
const createJobService = (
  config: PlatformConfig,
  repository: JobRepositoryShape,
  rateLimiter: RateLimiterShape,
): JobServiceShape => ({
  cancel: (id: string): Effect.Effect<JobResponse, JobServiceError> =>
    cancelJob(repository, id),
  get: (id: string): Effect.Effect<JobResponse, JobServiceError> =>
    getJobResponse(repository, id),
  getResult: (
    id: string,
    index: number,
  ): Effect.Effect<JobResult, DatabaseError | JobNotFoundError> =>
    getJobResult(repository, id, index),
  submit: (
    request: JobCreateRequest,
    clientKey: string,
  ): Effect.Effect<JobResponse, JobServiceError> =>
    submitJob(config, repository, rateLimiter, request, clientKey),
});

/** Public job use cases shared by every HTTP adapter. */
class JobService extends Effect.Service<JobService>()(ServiceTag.jobService, {
  effect: Effect.all([ConfigService, JobRepository, RateLimiter]).pipe(
    Effect.map(
      ([config, repository, rateLimiter]: readonly [
        PlatformConfig,
        JobRepositoryShape,
        RateLimiterShape,
      ]): JobServiceShape => createJobService(config, repository, rateLimiter),
    ),
  ),
}) {}

export {
  cancelJob,
  createJobService,
  getJobResponse,
  getJobResult,
  JobService,
  requireJob,
  submitJob,
  toJobResponse,
};
