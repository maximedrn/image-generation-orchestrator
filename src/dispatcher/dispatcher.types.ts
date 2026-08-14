import type { EngineConfig, PlatformConfig } from "@app/config/config.types.js";
import type { EngineGatewayShape, EnginePoolShape } from "@app/engine/engine.interface.js";
import type { JobRepositoryShape } from "@app/job/job-repository.interface.js";
import type { ResultStorageShape } from "@app/storage/storage.interface.js";

/** Infrastructure captured by dispatcher workers. */
interface DispatcherWorkerDependencies {
  readonly config: PlatformConfig;
  readonly gateway: EngineGatewayShape;
  readonly pool: EnginePoolShape;
  readonly repository: JobRepositoryShape;
  readonly storage: ResultStorageShape;
}

/** State required for one remote polling iteration. */
interface DispatcherPollContext {
  readonly consecutiveFailures: number;
  readonly engine: EngineConfig;
  readonly remoteJobId: string;
}

export type { DispatcherPollContext, DispatcherWorkerDependencies };
