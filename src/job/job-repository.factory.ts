import type { Database } from "bun:sqlite";

import {
  countQueuedJobs,
  getJobById,
  getJobResult,
  listJobResults,
  listRunningJobs,
  peekNextQueuedJob,
  pingJobRepository,
} from "@app/job/job-repository-read.helpers.js";
import type { JobRepositoryShape } from "@app/job/job-repository.interface.js";
import {
  bindRemoteJob,
  claimQueuedJob,
  createJobIfCapacity,
  renewJobLease,
  requestJobCancellation,
  saveJobResults,
  transitionJob,
} from "@app/job/job-repository-write.helpers.js";

/**
 * Builds the SQLite implementation of the database-vendor-neutral repository port.
 *
 * @param database - (Database) Open SQLite connection.
 * @returns (JobRepositoryShape) Fully effectful repository implementation.
 */
const createJobRepository = (database: Database): JobRepositoryShape => ({
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
  renewLease: renewJobLease.bind(undefined, database),
  requestCancellation: requestJobCancellation.bind(undefined, database),
  saveResults: saveJobResults.bind(undefined, database),
  transition: transitionJob.bind(undefined, database),
});

export { createJobRepository };
