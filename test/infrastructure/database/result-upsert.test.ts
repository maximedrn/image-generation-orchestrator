import { describe, expect, test } from "bun:test";
import type { DatabaseServiceShape } from "@app/infrastructure/database/database.types";
import { createJobRepository } from "@app/infrastructure/database/repository/job-repository.service";
import type { JobRepositoryShape } from "@app/modules/jobs/job.interface";
import type { Job, JobResult } from "@app/modules/jobs/job.types";
import {
  createJobFixture,
  createTestDatabase,
} from "@test/fixtures/platform.fixture";
import { TestArtefact } from "@test/fixtures/test.constants";
import { Effect } from "effect";

describe("result upsert", (): void => {
  test("replaces metadata when the same result index is saved twice", async (): Promise<void> => {
    const database: DatabaseServiceShape = createTestDatabase();
    const repository: JobRepositoryShape = createJobRepository(
      database.database,
    );
    const job: Job = createJobFixture("upsert-job");
    await Effect.runPromise(repository.createIfCapacity(job, 10));
    const first: JobResult = {
      index: 0,
      jobId: job.id,
      mimeType: TestArtefact.pngMimeType,
      path: "/tmp/first.png",
      sha256: "first",
      sizeBytes: 1,
    };
    await Effect.runPromise(repository.saveResults([first]));
    await Effect.runPromise(
      repository.saveResults([
        { ...first, path: "/tmp/second.png", sha256: "second", sizeBytes: 2 },
      ]),
    );
    const stored: readonly JobResult[] = await Effect.runPromise(
      repository.listResults(job.id),
    );
    database.client.close();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.path).toBe("/tmp/second.png");
    expect(stored[0]?.sha256).toBe("second");
    expect(stored[0]?.sizeBytes).toBe(2);
  });
});
