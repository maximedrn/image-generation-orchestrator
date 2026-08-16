import { afterEach, describe, expect, test } from "bun:test";
import type { PlatformConfig } from "@app/core/config/config.types";
import { ErrorTag } from "@app/core/errors/error.constants";
import type {
  DatabaseError,
  JobNotFoundError,
} from "@app/core/errors/error.types";
import { createRateLimiter } from "@app/core/security/rate-limit.service";
import type { RateLimiterShape } from "@app/core/security/security.interface";
import type { DatabaseServiceShape } from "@app/infrastructure/database/database.types";
import { createJobRepository } from "@app/infrastructure/database/repository/job-repository.service";
import {
  JobStatus,
  OutputFormat,
  OutputMimeType,
} from "@app/modules/jobs/job.constants";
import type {
  JobRepositoryShape,
  JobServiceError,
  JobServiceShape,
} from "@app/modules/jobs/job.interface";
import { createJobService, getJobResult } from "@app/modules/jobs/job.service";
import type {
  Job,
  JobCreateRequest,
  JobResponse,
  JobResult,
} from "@app/modules/jobs/job.types";
import {
  createJobFixture,
  createPlatformConfigFixture,
  createTestDatabase,
  JobRequestFixture,
  TestIdentifier,
} from "@test/fixtures/platform.fixture";
import { TestCaller, TestInstant } from "@test/fixtures/test.constants";
import { Effect, Either } from "effect";

/** Databases created by job-service integration tests. */
const JobServiceDatabases: DatabaseServiceShape[] = [];

/**
 * Creates a complete job service backed by an in-memory durable repository.
 *
 * @param {PlatformConfig} config - Test platform configuration.
 * @returns {Effect.Effect<JobServiceShape>} Ready job application service.
 */
const createJobServiceFixture = (
  config: PlatformConfig,
): Effect.Effect<JobServiceShape> =>
  Effect.gen(function* createJobServiceFixtureEffect() {
    const database: DatabaseServiceShape = createTestDatabase();
    JobServiceDatabases.push(database);
    const repository: JobRepositoryShape = createJobRepository(
      database.database,
    );
    const limiter: RateLimiterShape = yield* createRateLimiter(
      config.rateLimit,
    );
    return createJobService(config, repository, limiter);
  });

/**
 * Submits the canonical valid fixture through one application service.
 *
 * @param {JobServiceShape} service - Job application service.
 * @returns {Effect.Effect<JobResponse, JobServiceError>} Admission effect.
 */
const submitValidFixture = (
  service: JobServiceShape,
): Effect.Effect<JobResponse, JobServiceError> =>
  service.submit(JobRequestFixture, TestCaller.rateLimitKey);

/**
 * Submits a decoded request and materializes the typed failure channel as Either.
 *
 * @param {JobServiceShape} service - Job application service.
 * @param {JobCreateRequest} request - Schema-valid request fixture.
 * @returns {Effect.Effect<Either.Either<JobResponse, JobServiceError>>} Materialized result.
 */
const submitAsEither = (
  service: JobServiceShape,
  request: JobCreateRequest,
): Effect.Effect<Either.Either<JobResponse, JobServiceError>> =>
  Effect.either(service.submit(request, TestCaller.rateLimitKey));

afterEach((): void => {
  for (const database of JobServiceDatabases.splice(0)) {
    database.client.close();
  }
});

describe("job service admission", (): void => {
  test("accepts a fully valid request into the durable queue", async (): Promise<void> => {
    const config: PlatformConfig = createPlatformConfigFixture(
      "/tmp/job-service-valid",
    );
    const response: JobResponse = await Effect.runPromise(
      createJobServiceFixture(config).pipe(Effect.flatMap(submitValidFixture)),
    );
    expect(response.status).toBe(JobStatus.queued);
    expect(response.request.model).toBe(TestIdentifier.model);
    expect(response.error).toBeNull();
    expect("engineId" in response).toBe(false);
    expect("remoteJobId" in response).toBe(false);
    expect("leaseUntil" in response).toBe(false);
    expect("cost" in response).toBe(false);
  });

  test("keeps persisted result metadata private until the job succeeds", async (): Promise<void> => {
    const database: DatabaseServiceShape = createTestDatabase();
    JobServiceDatabases.push(database);
    const repository: JobRepositoryShape = createJobRepository(
      database.database,
    );
    const queued: Job = createJobFixture("partial-result-job");
    await Effect.runPromise(repository.createIfCapacity(queued, 10));
    await Effect.runPromise(
      repository.claim(queued.id, TestInstant.leaseRenewed, 1),
    );
    const metadata: JobResult = {
      index: 0,
      jobId: queued.id,
      mimeType: OutputMimeType[OutputFormat.png],
      path: "/tmp/partial-result.png",
      sha256: "test-sha256",
      sizeBytes: 5,
    };
    await Effect.runPromise(repository.saveResults([metadata]));
    const premature: Either.Either<
      JobResult,
      DatabaseError | JobNotFoundError
    > = await Effect.runPromise(
      Effect.either(getJobResult(repository, queued.id, 0)),
    );
    expect(Either.isLeft(premature)).toBe(true);
    await Effect.runPromise(
      repository.transition({
        changes: {},
        from: JobStatus.running,
        id: queued.id,
        to: JobStatus.succeeded,
      }),
    );
    const completed: JobResult = await Effect.runPromise(
      getJobResult(repository, queued.id, 0),
    );
    expect(completed.sha256).toBe(metadata.sha256);
  });

  // Shape validation now belongs to the transport pipe; what remains here is
  // the config-bound admission guard, which the schema cannot express.
  test("rejects a schema-valid request naming an unregistered model", async (): Promise<void> => {
    const config: PlatformConfig = createPlatformConfigFixture(
      "/tmp/job-service-invalid",
    );
    const unknownModel: JobCreateRequest = {
      ...JobRequestFixture,
      model: "model-that-is-not-registered",
    };
    const result: Either.Either<JobResponse, JobServiceError> =
      await Effect.runPromise(
        createJobServiceFixture(config).pipe(
          Effect.flatMap(
            (
              service: JobServiceShape,
            ): Effect.Effect<Either.Either<JobResponse, JobServiceError>> =>
              submitAsEither(service, unknownModel),
          ),
        ),
      );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe(ErrorTag.invalidRequest);
    }
  });
});
