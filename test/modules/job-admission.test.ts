import { afterEach, describe, expect, test } from "bun:test";
import type { PlatformConfig } from "@app/core/config/config.types";
import { ErrorTag } from "@app/core/errors/error.constants";
import { createRateLimiter } from "@app/core/security/rate-limit.service";
import type { RateLimiterShape } from "@app/core/security/security.interface";
import type { DatabaseServiceShape } from "@app/infrastructure/database/database.types";
import { createJobRepository } from "@app/infrastructure/database/repository/job-repository.service";
import type {
  JobRepositoryShape,
  JobServiceError,
  JobServiceShape,
} from "@app/modules/jobs/job.interface";
import { createJobService } from "@app/modules/jobs/job.service";
import type { JobResponse } from "@app/modules/jobs/job.types";
import {
  createPlatformConfigFixture,
  createTestDatabase,
  JobRequestFixture,
} from "@test/fixtures/platform.fixture";
import { Effect, Either } from "effect";

/** Databases opened by the running test. */
const OpenDatabases: DatabaseServiceShape[] = [];

afterEach((): void => {
  for (const database of OpenDatabases.splice(0)) database.client.close();
});

describe("job admission under a saturated queue", (): void => {
  test("rejects with a retry hint once the queue is full", async (): Promise<void> => {
    const database: DatabaseServiceShape = createTestDatabase();
    OpenDatabases.push(database);
    const base: PlatformConfig = createPlatformConfigFixture("/tmp/queue-full");
    const config: PlatformConfig = {
      ...base,
      queue: { ...base.queue, maxQueuedJobs: 0, pollIntervalMs: 2500 },
    };
    const repository: JobRepositoryShape = createJobRepository(
      database.database,
    );
    const outcome: Either.Either<JobResponse, JobServiceError> =
      await Effect.runPromise(
        Effect.gen(function* queueFullEffect() {
          const rateLimiter: RateLimiterShape = yield* createRateLimiter(
            config.rateLimit,
          );
          const service: JobServiceShape = createJobService(
            config,
            repository,
            rateLimiter,
          );
          return yield* Effect.either(
            service.submit(JobRequestFixture, "client-full"),
          );
        }),
      );
    expect(Either.isLeft(outcome)).toBe(true);
    if (Either.isLeft(outcome)) {
      expect(outcome.left._tag).toBe(ErrorTag.queueFull);
      // The retry hint is derived from the poll interval, never below one second.
      expect(
        "retryAfterSeconds" in outcome.left
          ? outcome.left.retryAfterSeconds
          : 0,
      ).toBe(3);
    }
  });
});
