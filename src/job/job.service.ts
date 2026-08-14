import { Context, Effect, Layer, Option, Schema } from "effect";

import { EFFECT_SERVICE_IDENTIFIER } from "@app/runtime/runtime.constants.js";
import { ConfigService } from "@app/config/config.service.js";
import type { PlatformConfig } from "@app/config/config.types.js";
import {
  type DatabaseError,
  InvalidRequestError,
  JobNotCancellableError,
  JobNotFoundError,
  QueueFullError,
} from "@app/error/error.types.js";
import { createQueuedJob } from "@app/job/job.factory.js";
import { validateJobLimits } from "@app/job/job.helpers.js";
import type { JobRepositoryShape } from "@app/job/job-repository.interface.js";
import { JobRepository } from "@app/job/job-repository.service.js";
import type { JobServiceError, JobServiceShape } from "@app/job/job.interface.js";
import {
  JOB_PUBLIC_ERROR_CODE,
  JOB_PUBLIC_ERROR_MESSAGE,
  JOB_RESULT_ROUTE_PREFIX,
  JOB_STATUS,
} from "@app/job/job.constants.js";
import type {
  Job,
  JobCreateRequest,
  JobResponse,
  JobResult,
} from "@app/job/job.types.js";
import { JobCreateRequestSchema } from "@app/job/job.types.js";
import type { RateLimiterShape } from "@app/rate-limit/rate-limit.interface.js";
import { RateLimiter } from "@app/rate-limit/rate-limit.service.js";
import { MILLISECONDS_PER_SECOND } from "@app/time/time.constants.js";

/** Minimum valid Retry-After value in seconds. */
const MINIMUM_RETRY_AFTER_SECONDS = 1;

/** Effect Context tag for public job use cases. */
class JobService extends Context.Tag(EFFECT_SERVICE_IDENTIFIER.JOB_SERVICE)<
  JobService,
  JobServiceShape
>() {}

/**
 * Converts a domain job plus result metadata into the stable public response.
 *
 * @param job - (Job) Durable job.
 * @param results - (readonly JobResult[]) Persisted result metadata.
 * @returns (JobResponse) Public API representation.
 */
const toJobResponse = (
  job: Job,
  results: readonly JobResult[],
): JobResponse => {
  const succeeded: boolean = job.status === JOB_STATUS.SUCCEEDED;
  return {
    cancelRequested: job.cancelRequested,
    createdAt: job.createdAt,
    error:
      job.status === JOB_STATUS.FAILED
        ? {
            code: JOB_PUBLIC_ERROR_CODE.GENERATION_FAILED,
            message: JOB_PUBLIC_ERROR_MESSAGE.GENERATION_FAILED,
          }
        : null,
    id: job.id,
    request: job.request,
    resultUrls: succeeded
      ? results.map(
          (result: JobResult): string =>
            `${JOB_RESULT_ROUTE_PREFIX}/${job.id}/results/${result.index}`,
        )
      : [],
    status: job.status,
    updatedAt: job.updatedAt,
  };
};

/**
 * Resolves a required job or fails with an explicit not-found error.
 *
 * @param repository - (JobRepositoryShape) Persistence adapter.
 * @param id - (string) Job identifier.
 * @returns (Effect.Effect<Job, JobServiceError>) Existing job.
 */
const requireJob = (
  repository: JobRepositoryShape,
  id: string,
): Effect.Effect<Job, JobServiceError> =>
  repository.getById(id).pipe(
    Effect.flatMap(
      (jobOption: Option.Option<Job>): Effect.Effect<Job, JobNotFoundError> =>
        Option.isNone(jobOption)
          ? Effect.fail(new JobNotFoundError({ id }))
          : Effect.succeed(jobOption.value),
    ),
  );

/**
 * Reads one job and its result metadata.
 *
 * @param repository - (JobRepositoryShape) Persistence adapter.
 * @param id - (string) Job identifier.
 * @returns (Effect.Effect<JobResponse, JobServiceError>) Public job response.
 */
const getJobResponse = (
  repository: JobRepositoryShape,
  id: string,
): Effect.Effect<JobResponse, JobServiceError> =>
  Effect.gen(function* getJobResponseEffect(): Generator<unknown, JobResponse> {
    const job: Job = yield* requireJob(repository, id);
    const results: readonly JobResult[] = yield* repository.listResults(id);
    return toJobResponse(job, results);
  });

/**
 * Cancels a queued job or requests remote cancellation for a running job.
 *
 * @param repository - (JobRepositoryShape) Persistence adapter.
 * @param id - (string) Job identifier.
 * @returns (Effect.Effect<JobResponse, JobServiceError>) Updated job response.
 */
const cancelJob = (
  repository: JobRepositoryShape,
  id: string,
): Effect.Effect<JobResponse, JobServiceError> =>
  Effect.gen(function* cancelJobEffect(): Generator<unknown, JobResponse> {
    const cancelledOption: Option.Option<Job> =
      yield* repository.requestCancellation(id);
    if (Option.isSome(cancelledOption)) {
      return toJobResponse(cancelledOption.value, []);
    }
    const current: Job = yield* requireJob(repository, id);
    return yield* Effect.fail(
      new JobNotCancellableError({
        id: current.id,
        message: `job ${current.id} is already terminal`,
      }),
    );
  });

/**
 * Reads one result descriptor only after the parent job is durably successful.
 *
 * @param repository - (JobRepositoryShape) Persistence adapter.
 * @param id - (string) Job identifier.
 * @param index - (number) Result index.
 * @returns (Effect.Effect<JobResult, DatabaseError | JobNotFoundError>) Result metadata.
 */
const getJobResult = (
  repository: JobRepositoryShape,
  id: string,
  index: number,
): Effect.Effect<JobResult, DatabaseError | JobNotFoundError> =>
  requireJob(repository, id).pipe(
    Effect.flatMap(
      (job: Job): Effect.Effect<Option.Option<JobResult>, DatabaseError | JobNotFoundError> =>
        job.status === JOB_STATUS.SUCCEEDED
          ? repository.getResult(id, index)
          : Effect.fail(new JobNotFoundError({ id: `${id}/results/${index}` })),
    ),
    Effect.flatMap(
      (
        resultOption: Option.Option<JobResult>,
      ): Effect.Effect<JobResult, JobNotFoundError> =>
        Option.isNone(resultOption)
          ? Effect.fail(new JobNotFoundError({ id: `${id}/results/${index}` }))
          : Effect.succeed(resultOption.value),
    ),
  );

/**
 * Decodes, validates, rate-limits and durably admits one generation request.
 *
 * @param config - (PlatformConfig) Runtime guardrails.
 * @param repository - (JobRepositoryShape) Persistence adapter.
 * @param rateLimiter - (RateLimiterShape) Admission rate limiter.
 * @param input - (unknown) Untrusted JSON request body.
 * @param clientKey - (string) Rate-limit key.
 * @returns (Effect.Effect<JobResponse, JobServiceError>) Accepted job response.
 */
const submitJob = (
  config: PlatformConfig,
  repository: JobRepositoryShape,
  rateLimiter: RateLimiterShape,
  input: unknown,
  clientKey: string,
): Effect.Effect<JobResponse, JobServiceError> =>
  Effect.gen(function* submitJobEffect(): Generator<unknown, JobResponse> {
    yield* rateLimiter.consume(clientKey);
    const request: JobCreateRequest = yield* Schema.decodeUnknown(
      JobCreateRequestSchema,
      { onExcessProperty: "error" },
    )(input).pipe(
      Effect.mapError(
        (): InvalidRequestError =>
          new InvalidRequestError({ message: "invalid generation request" }),
      ),
    );
    yield* validateJobLimits(request, config);
    const job: Job = yield* createQueuedJob(request);
    const accepted: boolean = yield* repository.createIfCapacity(
      job,
      config.queue.maxQueuedJobs,
    );
    if (!accepted) {
      const retryAfterSeconds: number = Math.max(
        MINIMUM_RETRY_AFTER_SECONDS,
        Math.ceil(config.queue.pollIntervalMs / MILLISECONDS_PER_SECOND),
      );
      return yield* Effect.fail(
        new QueueFullError({
          message: "generation queue is full",
          retryAfterSeconds,
        }),
      );
    }
    return toJobResponse(job, []);
  });

/**
 * Builds the job application service from explicit Effect dependencies.
 *
 * @param config - (PlatformConfig) Resolved application configuration.
 * @param repository - (JobRepositoryShape) Durable persistence port.
 * @param rateLimiter - (RateLimiterShape) Bounded local rate limiter.
 * @returns (JobServiceShape) Application service implementation.
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
    input: unknown,
    clientKey: string,
  ): Effect.Effect<JobResponse, JobServiceError> =>
    submitJob(config, repository, rateLimiter, input, clientKey),
});

/** Live job application layer. */
const JobServiceLive: Layer.Layer<
  JobService,
  never,
  ConfigService | JobRepository | RateLimiter
> = Layer.effect(
  JobService,
  Effect.gen(
    function* jobServiceLayerEffect(): Generator<unknown, JobServiceShape> {
      const config: PlatformConfig = yield* ConfigService;
      const repository: JobRepositoryShape = yield* JobRepository;
      const rateLimiter: RateLimiterShape = yield* RateLimiter;
      return createJobService(config, repository, rateLimiter);
    },
  ),
);

export {
  cancelJob,
  createJobService,
  getJobResponse,
  getJobResult,
  JobService,
  JobServiceLive,
  requireJob,
  submitJob,
  toJobResponse,
};
