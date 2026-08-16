import { ServiceTag } from "@app/core/runtime/service.constants";
import { DatabaseService } from "@app/infrastructure/database/database.service";
import type {
  DatabaseServiceShape,
  PlatformDatabase,
} from "@app/infrastructure/database/database.types";
import {
  countQueuedJobs,
  getJobById,
  getJobResult,
  listJobResults,
  listRunningJobs,
  peekNextQueuedJob,
  pingJobRepository,
} from "@app/infrastructure/database/repository/job-repository-read.helpers";
import {
  bindRemoteJob,
  claimQueuedJob,
  createJobIfCapacity,
  recordJobProgress,
  renewJobLease,
  requestJobCancellation,
  saveJobResults,
  transitionJob,
} from "@app/infrastructure/database/repository/job-repository-write.helpers";
import type { JobRepositoryShape } from "@app/modules/jobs/job.interface";
import { Effect } from "effect";

/**
 * Builds the Drizzle implementation of the vendor-neutral repository port.
 *
 * @param {PlatformDatabase} database - Typed Drizzle database.
 * @returns {JobRepositoryShape} Fully effectful repository implementation.
 */
const createJobRepository = (
  database: PlatformDatabase,
): JobRepositoryShape => ({
  bindRemote: bindRemoteJob.bind(undefined, database),
  claim: claimQueuedJob.bind(undefined, database),
  countQueued: countQueuedJobs.bind(undefined, database),
  createIfCapacity: createJobIfCapacity.bind(undefined, database),
  getById: getJobById.bind(undefined, database),
  getResult: getJobResult.bind(undefined, database),
  listResults: listJobResults.bind(undefined, database),
  listRunning: listRunningJobs.bind(undefined, database),
  peekNextQueued: peekNextQueuedJob.bind(undefined, database),
  ping: pingJobRepository.bind(undefined, database),
  recordProgress: recordJobProgress.bind(undefined, database),
  renewLease: renewJobLease.bind(undefined, database),
  requestCancellation: requestJobCancellation.bind(undefined, database),
  saveResults: saveJobResults.bind(undefined, database),
  transition: transitionJob.bind(undefined, database),
});

/** Durable job persistence. Swap this layer to migrate to another database. */
class JobRepository extends Effect.Service<JobRepository>()(
  ServiceTag.jobRepository,
  {
    effect: DatabaseService.pipe(
      Effect.map(
        (service: DatabaseServiceShape): JobRepositoryShape =>
          createJobRepository(service.database),
      ),
    ),
  },
) {}

export { createJobRepository, JobRepository };
