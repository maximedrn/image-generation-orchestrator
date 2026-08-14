import type { Effect, Option } from "effect";

import type { EngineConfig } from "@app/config/config.types.js";
import type {
  EngineProtocolError,
  EngineRejectedError,
  EngineUnavailableError,
} from "@app/error/error.types.js";
import type {
  EngineCapabilities,
  EngineJob,
  EngineReservation,
  EngineSubmission,
  EngineView,
} from "@app/engine/engine.types.js";
import type { JobCreateRequest } from "@app/job/job.types.js";

/** Typed errors produced by a concrete engine network adapter. */
type EngineGatewayError =
  | EngineProtocolError
  | EngineRejectedError
  | EngineUnavailableError;

/** Provider-neutral inference port implemented by concrete engine adapters. */
interface EngineGatewayShape {
  readonly cancel: (
    engine: EngineConfig,
    remoteJobId: string,
  ) => Effect.Effect<EngineJob, EngineGatewayError>;
  readonly capabilities: (
    engine: EngineConfig,
  ) => Effect.Effect<EngineCapabilities, EngineGatewayError>;
  readonly poll: (
    engine: EngineConfig,
    remoteJobId: string,
  ) => Effect.Effect<EngineJob, EngineGatewayError>;
  readonly submit: (
    engine: EngineConfig,
    request: JobCreateRequest,
  ) => Effect.Effect<EngineSubmission, EngineGatewayError>;
}

/** In-memory engine scheduler port with atomic capacity reservations. */
interface EnginePoolShape {
  readonly list: () => Effect.Effect<readonly EngineView[]>;
  readonly recordFailure: (engineId: string) => Effect.Effect<void>;
  readonly recordSuccess: (engineId: string) => Effect.Effect<void>;
  readonly release: (engineId: string) => Effect.Effect<void>;
  readonly reserve: (
    model: string,
  ) => Effect.Effect<Option.Option<EngineReservation>>;
  readonly reserveById: (
    engineId: string,
    model: string,
  ) => Effect.Effect<Option.Option<EngineReservation>>;
}

export type { EngineGatewayError, EngineGatewayShape, EnginePoolShape };
