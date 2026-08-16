import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { ErrorTag } from "@app/core/errors/error.constants";
import type { DatabaseError } from "@app/core/errors/error.types";
import { DatabaseSettings } from "@app/infrastructure/database/database.constants";
import * as schema from "@app/infrastructure/database/database.schema";
import { jobs } from "@app/infrastructure/database/database.schema";
import { openDatabase } from "@app/infrastructure/database/database.service";
import type {
  DatabaseServiceShape,
  PlatformDatabase,
} from "@app/infrastructure/database/database.types";
import { createJobRepository } from "@app/infrastructure/database/repository/job-repository.service";
import type { JobRepositoryShape } from "@app/modules/jobs/job.interface";
import type { Job } from "@app/modules/jobs/job.types";
import {
  createJobFixture,
  createPlatformConfigFixture,
  createTestDatabase,
} from "@test/fixtures/platform.fixture";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Effect, Either, Option } from "effect";

/** Databases opened by the running test. */
const OpenDatabases: DatabaseServiceShape[] = [];

afterEach((): void => {
  for (const database of OpenDatabases.splice(0)) database.client.close();
});

describe("durable storage failures", (): void => {
  test("refuses to open a database under an read-only path", (): void => {
    expect(
      (): DatabaseServiceShape =>
        openDatabase({
          ...createPlatformConfigFixture("/proc/definitely/not/writable"),
        }),
    ).toThrow();
  });

  test("reports a stored request that is no longer valid JSON", async (): Promise<void> => {
    const database: DatabaseServiceShape = createTestDatabase();
    OpenDatabases.push(database);
    const repository: JobRepositoryShape = createJobRepository(
      database.database,
    );
    const job: Job = createJobFixture("corrupt-json");
    await Effect.runPromise(repository.createIfCapacity(job, 10));
    database.client
      .query("UPDATE jobs SET request_json = ? WHERE id = ?")
      .run("{not json", job.id);
    const outcome: Either.Either<
      Option.Option<Job>,
      DatabaseError
    > = await Effect.runPromise(Effect.either(repository.getById(job.id)));
    expect(Either.isLeft(outcome)).toBe(true);
    if (Either.isLeft(outcome)) {
      expect(outcome.left._tag).toBe(ErrorTag.database);
    }
  });

  test("reports a stored request that no longer satisfies the schema", async (): Promise<void> => {
    const database: DatabaseServiceShape = createTestDatabase();
    OpenDatabases.push(database);
    const repository: JobRepositoryShape = createJobRepository(
      database.database,
    );
    const job: Job = createJobFixture("stale-request");
    await Effect.runPromise(repository.createIfCapacity(job, 10));
    database.client
      .query("UPDATE jobs SET request_json = ? WHERE id = ?")
      .run(JSON.stringify({ prompt: "only a prompt" }), job.id);
    const outcome: Either.Either<
      Option.Option<Job>,
      DatabaseError
    > = await Effect.runPromise(Effect.either(repository.getById(job.id)));
    expect(Either.isLeft(outcome)).toBe(true);
  });

  test("reports a stored status outside the state machine", async (): Promise<void> => {
    const database: DatabaseServiceShape = createTestDatabase();
    OpenDatabases.push(database);
    const repository: JobRepositoryShape = createJobRepository(
      database.database,
    );
    const job: Job = createJobFixture("bad-status");
    await Effect.runPromise(repository.createIfCapacity(job, 10));
    database.client
      .query("UPDATE jobs SET status = ? WHERE id = ?")
      .run("not-a-status", job.id);
    const outcome: Either.Either<
      Option.Option<Job>,
      DatabaseError
    > = await Effect.runPromise(Effect.either(repository.getById(job.id)));
    expect(Either.isLeft(outcome)).toBe(true);
  });

  test("reports a failure when the underlying connection is closed", async (): Promise<void> => {
    const client: Database = new Database(":memory:", { strict: true });
    const database: PlatformDatabase = drizzle({ client, schema });
    migrate(database, { migrationsFolder: DatabaseSettings.migrationsFolder });
    const repository: JobRepositoryShape = createJobRepository(database);
    client.close();
    const outcome: Either.Either<void, DatabaseError> = await Effect.runPromise(
      Effect.either(repository.ping()),
    );
    expect(Either.isLeft(outcome)).toBe(true);
    if (Either.isLeft(outcome)) {
      expect(outcome.left._tag).toBe(ErrorTag.database);
    }
    expect(jobs).toBeDefined();
  });
});
