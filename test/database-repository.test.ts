import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Effect, Option } from "effect";

import { runMigrations } from "@app/database/database.service.js";
import { JOB_STATUS, OUTPUT_FORMAT, OUTPUT_MIME_TYPE } from "@app/job/job.constants.js";
import { createJobRepository } from "@app/job/job-repository.factory.js";
import type { JobRepositoryShape } from "@app/job/job-repository.interface.js";
import type { Job, JobResult } from "@app/job/job.types.js";
import { createJobFixture, TEST_ENGINE_ID } from "@test/platform.fixture.js";

/** Open in-memory databases requiring test cleanup. */
const DATABASES: Database[] = [];
/** Number of simultaneous admissions used by the overload regression test. */
const CONCURRENT_ADMISSION_REQUEST_COUNT = 100;

/** Durable queue capacity used by the concurrent admission regression test. */
const CONCURRENT_ADMISSION_CAPACITY = 7;

/** Number of jobs submitted to the concurrent claim regression test. */
const CONCURRENT_CLAIM_REQUEST_COUNT = 12;

/** Maximum running jobs allowed by the concurrent claim regression test. */
const CONCURRENT_RUNNING_CAPACITY = 3;


/**
 * Creates and tracks an in-memory migrated database.
 *
 * @returns (Database) Migrated in-memory database.
 */
const createDatabase = (): Database => {
  const database: Database = new Database(":memory:", { strict: true });
  runMigrations(database);
  DATABASES.push(database);
  return database;
};

afterEach((): void => {
  DATABASES.splice(0).forEach((database: Database): void => {
    database.close();
  });
});

describe("SQLite job repository transitions", (): void => {
  test("admits, claims and transitions a durable job", async (): Promise<void> => {
    const repository: JobRepositoryShape = createJobRepository(createDatabase());
    const job: Job = createJobFixture("job-repository-1");
    const admitted: boolean = await Effect.runPromise(
      repository.createIfCapacity(job, 10),
    );
    expect(admitted).toBe(true);
    const claimed: Option.Option<Job> = await Effect.runPromise(
      repository.claim(job.id, "2099-01-01T00:00:00.000Z", 1),
    );
    expect(Option.isSome(claimed)).toBe(true);
    if (Option.isSome(claimed)) {
      expect(claimed.value.status).toBe(JOB_STATUS.RUNNING);
      expect(claimed.value.attempt).toBe(1);
    }
    const transitioned: Option.Option<Job> = await Effect.runPromise(
      repository.transition({
        changes: { engineId: null, leaseUntil: null, remoteJobId: null },
        from: JOB_STATUS.RUNNING,
        id: job.id,
        to: JOB_STATUS.SUCCEEDED,
      }),
    );
    expect(Option.isSome(transitioned)).toBe(true);
  });
});

describe("SQLite job repository capacity", (): void => {
  test("enforces queued capacity atomically", async (): Promise<void> => {
    const repository: JobRepositoryShape = createJobRepository(createDatabase());
    const firstAccepted: boolean = await Effect.runPromise(
      repository.createIfCapacity(createJobFixture("a"), 1),
    );
    const secondAccepted: boolean = await Effect.runPromise(
      repository.createIfCapacity(createJobFixture("b"), 1),
    );
    expect(firstAccepted).toBe(true);
    expect(secondAccepted).toBe(false);
  });
});

describe("SQLite job repository results", (): void => {
  test("persists a complete result batch", async (): Promise<void> => {
    const repository: JobRepositoryShape = createJobRepository(createDatabase());
    const job: Job = createJobFixture("result-batch-job");
    await Effect.runPromise(repository.createIfCapacity(job, 10));
    const results: readonly JobResult[] = [
      {
        index: 0,
        jobId: job.id,
        mimeType: OUTPUT_MIME_TYPE[OUTPUT_FORMAT.PNG],
        path: "/tmp/result-0.png",
        sha256: "sha-0",
        sizeBytes: 10,
      },
      {
        index: 1,
        jobId: job.id,
        mimeType: OUTPUT_MIME_TYPE[OUTPUT_FORMAT.PNG],
        path: "/tmp/result-1.png",
        sha256: "sha-1",
        sizeBytes: 20,
      },
    ];
    await Effect.runPromise(repository.saveResults(results));
    expect(await Effect.runPromise(repository.listResults(job.id))).toEqual(results);
  });
});

describe("SQLite job repository recovery", (): void => {
  test("preserves remote metadata for restart recovery", async (): Promise<void> => {
    const repository: JobRepositoryShape = createJobRepository(createDatabase());
    const job: Job = createJobFixture("recoverable-job");
    await Effect.runPromise(repository.createIfCapacity(job, 10));
    const claimed: Option.Option<Job> = await Effect.runPromise(
      repository.claim(job.id, "2099-01-01T00:00:00.000Z", 1),
    );
    expect(Option.isSome(claimed)).toBe(true);
    const bound: Option.Option<Job> = await Effect.runPromise(
      repository.bindRemote(
        job.id,
        TEST_ENGINE_ID,
        "remote-42",
        "2099-01-01T00:01:00.000Z",
      ),
    );
    expect(Option.isSome(bound)).toBe(true);
    const runningJobs: readonly Job[] = await Effect.runPromise(
      repository.listRunning(),
    );
    expect(runningJobs).toHaveLength(1);
    expect(runningJobs[0]?.engineId).toBe(TEST_ENGINE_ID);
    expect(runningJobs[0]?.remoteJobId).toBe("remote-42");
  });
});

describe("SQLite job repository cancellation", (): void => {
  test("atomically cancels queued work", async (): Promise<void> => {
    const repository: JobRepositoryShape = createJobRepository(createDatabase());
    const job: Job = createJobFixture("queued-cancellation");
    await Effect.runPromise(repository.createIfCapacity(job, 10));
    const cancelled: Option.Option<Job> = await Effect.runPromise(
      repository.requestCancellation(job.id),
    );
    expect(Option.isSome(cancelled)).toBe(true);
    if (Option.isSome(cancelled)) {
      expect(cancelled.value.status).toBe(JOB_STATUS.CANCELLED);
      expect(cancelled.value.cancelRequested).toBe(true);
    }
  });

  test("marks already-running work without changing its status", async (): Promise<void> => {
    const repository: JobRepositoryShape = createJobRepository(createDatabase());
    const job: Job = createJobFixture("running-cancellation");
    await Effect.runPromise(repository.createIfCapacity(job, 10));
    await Effect.runPromise(
      repository.claim(job.id, "2099-01-01T00:00:00.000Z", 1),
    );
    const requested: Option.Option<Job> = await Effect.runPromise(
      repository.requestCancellation(job.id),
    );
    expect(Option.isSome(requested)).toBe(true);
    if (Option.isSome(requested)) {
      expect(requested.value.status).toBe(JOB_STATUS.RUNNING);
      expect(requested.value.cancelRequested).toBe(true);
    }
  });
});


describe("SQLite job repository concurrency bounds", (): void => {
  test("never admits more queued jobs than capacity under concurrent pressure", async (): Promise<void> => {
    const repository: JobRepositoryShape = createJobRepository(createDatabase());
    const jobs: readonly Job[] = Array.from(
      { length: CONCURRENT_ADMISSION_REQUEST_COUNT },
      (_value: unknown, index: number): Job =>
        createJobFixture(`concurrent-admission-${index}`),
    );
    const attempts: readonly Promise<boolean>[] = jobs.map(
      (job: Job): Promise<boolean> =>
        Effect.runPromise(
          repository.createIfCapacity(job, CONCURRENT_ADMISSION_CAPACITY),
        ),
    );
    const accepted: readonly boolean[] = await Promise.all(attempts);
    const acceptedCount: number = accepted.filter(
      (value: boolean): boolean => value,
    ).length;
    expect(acceptedCount).toBe(CONCURRENT_ADMISSION_CAPACITY);
    expect(await Effect.runPromise(repository.countQueued())).toBe(
      CONCURRENT_ADMISSION_CAPACITY,
    );
  });

  test("never claims more running jobs than the global running bound", async (): Promise<void> => {
    const repository: JobRepositoryShape = createJobRepository(createDatabase());
    const jobs: readonly Job[] = Array.from(
      { length: CONCURRENT_CLAIM_REQUEST_COUNT },
      (_value: unknown, index: number): Job => createJobFixture(`claim-${index}`),
    );
    for (const job: Job of jobs) {
      await Effect.runPromise(
        repository.createIfCapacity(job, CONCURRENT_CLAIM_REQUEST_COUNT),
      );
    }
    const attempts: readonly Promise<Option.Option<Job>>[] = jobs.map(
      (job: Job): Promise<Option.Option<Job>> =>
        Effect.runPromise(
          repository.claim(
            job.id,
            "2099-01-01T00:00:00.000Z",
            CONCURRENT_RUNNING_CAPACITY,
          ),
        ),
    );
    const claimed: readonly Option.Option<Job>[] = await Promise.all(attempts);
    const claimedCount: number = claimed.filter(
      (job: Option.Option<Job>): boolean => Option.isSome(job),
    ).length;
    expect(claimedCount).toBe(CONCURRENT_RUNNING_CAPACITY);
    expect(await Effect.runPromise(repository.listRunning())).toHaveLength(
      CONCURRENT_RUNNING_CAPACITY,
    );
  });
});
