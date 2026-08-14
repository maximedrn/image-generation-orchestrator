import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Effect, Either, Ref } from "effect";

import type { PlatformConfig } from "@app/config/config.types.js";
import { runMigrations } from "@app/database/database.service.js";
import { createJobRepository } from "@app/job/job-repository.factory.js";
import type { JobRepositoryShape } from "@app/job/job-repository.interface.js";
import { createJobService, getJobResult } from "@app/job/job.service.js";
import type { JobServiceError, JobServiceShape } from "@app/job/job.interface.js";
import { JOB_STATUS, OUTPUT_FORMAT, OUTPUT_MIME_TYPE } from "@app/job/job.constants.js";
import type { DatabaseError, JobNotFoundError } from "@app/error/error.types.js";
import type { Job, JobResponse, JobResult } from "@app/job/job.types.js";
import { createRateLimiter } from "@app/rate-limit/rate-limit.service.js";
import type { RateLimiterShape } from "@app/rate-limit/rate-limit.interface.js";
import type { RateLimitBucket } from "@app/rate-limit/rate-limit.types.js";
import {
  createJobFixture,
  createPlatformConfigFixture,
  JOB_REQUEST_FIXTURE,
  TEST_MODEL_ID,
} from "@test/platform.fixture.js";

/** Databases created by job-service integration tests. */
const JOB_SERVICE_DATABASES: Database[] = [];

/**
 * Creates a complete job service backed by an in-memory durable repository.
 *
 * @param config - (PlatformConfig) Test platform configuration.
 * @returns (Effect.Effect<JobServiceShape>) Ready job application service.
 */
const createJobServiceFixture = (
  config: PlatformConfig,
): Effect.Effect<JobServiceShape> =>
  Effect.gen(function* createJobServiceFixtureEffect(): Generator<
    unknown,
    JobServiceShape
  > {
    const database: Database = new Database(":memory:", { strict: true });
    runMigrations(database);
    JOB_SERVICE_DATABASES.push(database);
    const repository: JobRepositoryShape = createJobRepository(database);
    const state: Ref.Ref<ReadonlyMap<string, RateLimitBucket>> =
      yield* Ref.make(new Map<string, RateLimitBucket>());
    const limiter: RateLimiterShape = createRateLimiter(config.rateLimit, state);
    return createJobService(config, repository, limiter);
  });

/**
 * Submits the canonical valid fixture through one application service.
 *
 * @param service - (JobServiceShape) Job application service.
 * @returns (Effect.Effect<JobResponse, JobServiceError>) Admission effect.
 */
const submitValidFixture = (
  service: JobServiceShape,
): Effect.Effect<JobResponse, JobServiceError> =>
  service.submit(JOB_REQUEST_FIXTURE, "client-a");

/**
 * Submits untrusted input and materializes the typed failure channel as Either.
 *
 * @param service - (JobServiceShape) Job application service.
 * @param input - (unknown) Untrusted request fixture.
 * @returns (Effect.Effect<Either.Either<JobResponse, JobServiceError>>) Materialized result.
 */
const submitAsEither = (
  service: JobServiceShape,
  input: unknown,
): Effect.Effect<Either.Either<JobResponse, JobServiceError>> =>
  Effect.either(service.submit(input, "client-a"));

afterEach((): void => {
  JOB_SERVICE_DATABASES.splice(0).forEach((database: Database): void => {
    database.close();
  });
});

describe("job service admission", (): void => {
  test("accepts a fully valid request into the durable queue", async (): Promise<void> => {
    const config: PlatformConfig = createPlatformConfigFixture(
      "/tmp/job-service-valid",
    );
    const response: JobResponse = await Effect.runPromise(
      createJobServiceFixture(config).pipe(Effect.flatMap(submitValidFixture)),
    );
    expect(response.status).toBe(JOB_STATUS.QUEUED);
    expect(response.request.model).toBe(TEST_MODEL_ID);
    expect(response.error).toBeNull();
    expect("engineId" in response).toBe(false);
    expect("remoteJobId" in response).toBe(false);
    expect("leaseUntil" in response).toBe(false);
    expect("cost" in response).toBe(false);
  });

  test("keeps persisted result metadata private until the job succeeds", async (): Promise<void> => {
    const database: Database = new Database(":memory:", { strict: true });
    runMigrations(database);
    JOB_SERVICE_DATABASES.push(database);
    const repository: JobRepositoryShape = createJobRepository(database);
    const queued: Job = createJobFixture("partial-result-job");
    await Effect.runPromise(repository.createIfCapacity(queued, 10));
    await Effect.runPromise(
      repository.claim(queued.id, "2026-08-14T12:02:00.000Z", 1),
    );
    const metadata: JobResult = {
      index: 0,
      jobId: queued.id,
      mimeType: OUTPUT_MIME_TYPE[OUTPUT_FORMAT.PNG],
      path: "/tmp/partial-result.png",
      sha256: "test-sha256",
      sizeBytes: 5,
    };
    await Effect.runPromise(repository.saveResults([metadata]));
    const premature: Either.Either<
      JobResult,
      DatabaseError | JobNotFoundError
    > = await Effect.runPromise(Effect.either(getJobResult(repository, queued.id, 0)));
    expect(Either.isLeft(premature)).toBe(true);
    await Effect.runPromise(
      repository.transition({
        changes: {},
        from: JOB_STATUS.RUNNING,
        id: queued.id,
        to: JOB_STATUS.SUCCEEDED,
      }),
    );
    const completed: JobResult = await Effect.runPromise(
      getJobResult(repository, queued.id, 0),
    );
    expect(completed.sha256).toBe(metadata.sha256);
  });

  test("rejects malformed input through the explicit error channel", async (): Promise<void> => {
    const config: PlatformConfig = createPlatformConfigFixture(
      "/tmp/job-service-invalid",
    );
    const malformedInput: unknown = { ...JOB_REQUEST_FIXTURE, width: "512" };
    const result: Either.Either<JobResponse, JobServiceError> =
      await Effect.runPromise(
        createJobServiceFixture(config).pipe(
          Effect.flatMap(
            (service: JobServiceShape): Effect.Effect<
              Either.Either<JobResponse, JobServiceError>
            > => submitAsEither(service, malformedInput),
          ),
        ),
      );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("InvalidRequestError");
    }
  });
});
