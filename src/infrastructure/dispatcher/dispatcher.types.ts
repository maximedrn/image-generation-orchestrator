import type {
  EngineConfig,
  PlatformConfig,
} from "@app/core/config/config.types";
import type {
  EngineGatewayShape,
  EnginePoolShape,
} from "@app/infrastructure/engine/engine.interface";
import type { ResultStorageShape } from "@app/infrastructure/storage/storage.interface";
import type { JobRepositoryShape } from "@app/modules/jobs/job.interface";

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
