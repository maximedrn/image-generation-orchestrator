import type { EngineConfig } from "@app/core/config/config.types";
import type {
  EngineBusyError,
  EngineJobNotFoundError,
  EngineProtocolError,
  EngineRejectedError,
  EngineUnavailableError,
} from "@app/core/errors/error.types";
import type {
  EngineCapabilities,
  EngineJob,
  EngineReservation,
  EngineSubmission,
  EngineView,
} from "@app/infrastructure/engine/engine.types";
import type { JobCreateRequest } from "@app/modules/jobs/job.types";
import type { Effect, Option } from "effect";

/** Typed errors produced by a concrete engine network adapter. */
type EngineGatewayError =
  | EngineBusyError
  | EngineJobNotFoundError
  | EngineProtocolError
  | EngineRejectedError
  | EngineUnavailableError;

/** Provider-neutral inference port implemented by concrete engine adapters. */
interface EngineGatewayShape {
  /** Asks the engine to abandon a generation it accepted. */
  readonly cancel: (
    engine: EngineConfig,
    remoteJobId: string,
  ) => Effect.Effect<EngineJob, EngineGatewayError>;
  /** Probes what the engine can do, which readiness turns into a verdict. */
  readonly capabilities: (
    engine: EngineConfig,
  ) => Effect.Effect<EngineCapabilities, EngineGatewayError>;
  /** Reads the current state of a remote generation, results included. */
  readonly poll: (
    engine: EngineConfig,
    remoteJobId: string,
  ) => Effect.Effect<EngineJob, EngineGatewayError>;
  /** Hands one generation to the engine and returns its remote identifier. */
  readonly submit: (
    engine: EngineConfig,
    request: JobCreateRequest,
  ) => Effect.Effect<EngineSubmission, EngineGatewayError>;
}

/** In-memory engine scheduler port with atomic capacity reservations. */
interface EnginePoolShape {
  /** Lists every engine with its health and current load. */
  readonly list: () => Effect.Effect<readonly EngineView[]>;
  /** Reports a failed exchange, which can open the circuit breaker. */
  readonly recordFailure: (engineId: string) => Effect.Effect<void>;
  /** Reports a successful exchange, which closes the circuit breaker. */
  readonly recordSuccess: (engineId: string) => Effect.Effect<void>;
  /** Gives one reserved slot back, whatever the outcome of the job. */
  readonly release: (engineId: string) => Effect.Effect<void>;
  /** Reserves a slot on any healthy engine serving the model. */
  readonly reserve: (
    model: string,
  ) => Effect.Effect<Option.Option<EngineReservation>>;
  /** Reserves a slot on one named engine, used when recovering a bound job. */
  readonly reserveById: (
    engineId: string,
    model: string,
  ) => Effect.Effect<Option.Option<EngineReservation>>;
}

export type { EngineGatewayError, EngineGatewayShape, EnginePoolShape };
