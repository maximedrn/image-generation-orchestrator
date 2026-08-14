import { Context, Effect, Layer } from "effect";

import { EFFECT_SERVICE_IDENTIFIER } from "@app/runtime/runtime.constants.js";
import type { DatabaseServiceShape } from "@app/database/database.interface.js";
import { DatabaseService } from "@app/database/database.service.js";
import { createJobRepository } from "@app/job/job-repository.factory.js";
import type { JobRepositoryShape } from "@app/job/job-repository.interface.js";

/** Effect Context tag for the database-vendor-neutral job persistence port. */
class JobRepository extends Context.Tag(EFFECT_SERVICE_IDENTIFIER.JOB_REPOSITORY)<
  JobRepository,
  JobRepositoryShape
>() {}

/** Live SQLite repository layer; swap this layer to migrate to MySQL/PostgreSQL. */
const JobRepositoryLive: Layer.Layer<
  JobRepository,
  never,
  DatabaseService
> = Layer.effect(
  JobRepository,
  Effect.gen(function* jobRepositoryLayerEffect(): Generator<
    unknown,
    JobRepositoryShape
  > {
    const databaseService: DatabaseServiceShape = yield* DatabaseService;
    return createJobRepository(databaseService.sqlite);
  }),
);

export { JobRepository, JobRepositoryLive };
