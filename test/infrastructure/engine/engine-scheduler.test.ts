import { describe, expect, test } from "bun:test";
import { ConfigService } from "@app/core/config/config.service";
import type {
  EngineConfig,
  PlatformConfig,
} from "@app/core/config/config.types";
import { ErrorTag } from "@app/core/errors/error.constants";
import { EngineHealth } from "@app/infrastructure/engine/engine.constants";
import { createEngineGatewayRouter } from "@app/infrastructure/engine/engine.factory";
import type {
  EngineGatewayError,
  EngineGatewayShape,
  EnginePoolShape,
} from "@app/infrastructure/engine/engine.interface";
import { EngineGateway } from "@app/infrastructure/engine/engine.service";
import type {
  EngineCapabilities,
  EngineJob,
  EngineReservation,
  EngineRuntimeState,
  EngineSubmission,
  EngineView,
} from "@app/infrastructure/engine/engine.types";
import {
  createInitialEngineState,
  recordEngineFailure,
  recordEngineSuccess,
  releaseEngineReservation,
  reserveEngineById,
  selectEngine,
  toEngineViews,
} from "@app/infrastructure/engine/pool/engine-pool.helpers";
import { EnginePool } from "@app/infrastructure/engine/pool/engine-pool.service";
import type { JobCreateRequest } from "@app/modules/jobs/job.types";
import { FetchHttpClient } from "@effect/platform";
import {
  createPlatformConfigFixture,
  getFirstEngineFixture,
  JobRequestFixture,
  TestIdentifier,
} from "@test/fixtures/platform.fixture";
import { TestRemoteJobId } from "@test/fixtures/test.constants";
import { Effect, Either, Layer, Option } from "effect";

/** Identifier of the second engine used to exercise least-loaded ordering. */
const SecondEngineId: string = "engine-b";

/** Engine identifier that is never present in any fixture configuration. */
const AbsentEngineId: string = "engine-absent";

/**
 * Builds a two-engine configuration so scheduler ordering has something to sort.
 *
 * @param {string} storageRoot - Disposable storage path.
 * @returns {PlatformConfig} Configuration declaring two compatible engines.
 */
const createTwoEngineConfig = (storageRoot: string): PlatformConfig => {
  const config: PlatformConfig = createPlatformConfigFixture(storageRoot);
  const first: EngineConfig = getFirstEngineFixture(config);
  return {
    ...config,
    engines: [
      { ...first, maxConcurrent: 2 },
      { ...first, id: SecondEngineId, maxConcurrent: 2 },
    ],
  };
};

/** Adapter recording which provider-neutral operation the router dispatched. */
const RecordingAdapter: EngineGatewayShape = {
  cancel: (
    _engine: EngineConfig,
    remoteJobId: string,
  ): Effect.Effect<EngineJob> =>
    Effect.succeed({
      error: null,
      id: `cancel:${remoteJobId}`,
      result: null,
      status: "cancelled",
    }),
  capabilities: (_engine: EngineConfig): Effect.Effect<EngineCapabilities> =>
    Effect.succeed({ outputFormats: [], supportsImageGeneration: true }),
  poll: (
    _engine: EngineConfig,
    remoteJobId: string,
  ): Effect.Effect<EngineJob> =>
    Effect.succeed({
      error: null,
      id: `poll:${remoteJobId}`,
      result: null,
      status: "running",
    }),
  submit: (
    _engine: EngineConfig,
    _request: JobCreateRequest,
  ): Effect.Effect<EngineSubmission> => Effect.succeed({ id: "submitted" }),
};

describe("engine scheduler state transitions", (): void => {
  test("orders compatible engines by relative load", (): void => {
    const config: PlatformConfig = createTwoEngineConfig("/tmp/engine-order");
    const loaded: ReadonlyMap<string, EngineRuntimeState> = new Map(
      createInitialEngineState(config.engines),
    ).set(TestIdentifier.engine, {
      consecutiveFailures: 0,
      health: EngineHealth.healthy,
      openUntilEpochMs: 0,
      running: 1,
    });
    const selected: EngineConfig | undefined = selectEngine(
      config.engines,
      loaded,
      TestIdentifier.model,
      0,
    );
    expect(selected?.id).toBe(SecondEngineId);
  });

  test("breaks a load tie on the engine identifier", (): void => {
    const config: PlatformConfig = createTwoEngineConfig("/tmp/engine-tie");
    const selected: EngineConfig | undefined = selectEngine(
      config.engines,
      createInitialEngineState(config.engines),
      TestIdentifier.model,
      0,
    );
    expect(selected?.id).toBe(TestIdentifier.engine);
  });

  test("clears failures and reopens the circuit on success", (): void => {
    const config: PlatformConfig = createPlatformConfigFixture(
      "/tmp/engine-success",
    );
    const failed: ReadonlyMap<string, EngineRuntimeState> = recordEngineFailure(
      config,
      createInitialEngineState(config.engines),
      TestIdentifier.engine,
      0,
    );
    expect(failed.get(TestIdentifier.engine)?.health).toBe(
      EngineHealth.degraded,
    );
    const recovered: ReadonlyMap<string, EngineRuntimeState> =
      recordEngineSuccess(failed, TestIdentifier.engine);
    const state: EngineRuntimeState | undefined = recovered.get(
      TestIdentifier.engine,
    );
    expect(state?.consecutiveFailures).toBe(0);
    expect(state?.health).toBe(EngineHealth.healthy);
    expect(state?.openUntilEpochMs).toBe(0);
  });

  test("leaves state untouched for an engine it does not know", (): void => {
    const config: PlatformConfig = createPlatformConfigFixture(
      "/tmp/engine-unknown",
    );
    const states: ReadonlyMap<string, EngineRuntimeState> =
      createInitialEngineState(config.engines);
    expect(recordEngineFailure(config, states, AbsentEngineId, 0)).toBe(states);
    expect(recordEngineSuccess(states, AbsentEngineId)).toBe(states);
    expect(releaseEngineReservation(states, AbsentEngineId)).toBe(states);
    expect(reserveEngineById(config, states, AbsentEngineId, "m", 0)[1]).toBe(
      states,
    );
  });

  test("never drives a release below zero", (): void => {
    const config: PlatformConfig = createPlatformConfigFixture(
      "/tmp/engine-release",
    );
    const released: ReadonlyMap<string, EngineRuntimeState> =
      releaseEngineReservation(
        createInitialEngineState(config.engines),
        TestIdentifier.engine,
      );
    expect(released.get(TestIdentifier.engine)?.running).toBe(0);
  });

  test("refuses a targeted reservation for an incompatible model", (): void => {
    const config: PlatformConfig = createPlatformConfigFixture(
      "/tmp/engine-targeted",
    );
    const [reservation]: readonly [
      Option.Option<EngineReservation>,
      ReadonlyMap<string, EngineRuntimeState>,
    ] = reserveEngineById(
      config,
      createInitialEngineState(config.engines),
      TestIdentifier.engine,
      "model-not-served-here",
      0,
    );
    expect(Option.isNone(reservation)).toBe(true);
  });

  test("reports an engine with no state as offline", (): void => {
    const config: PlatformConfig =
      createPlatformConfigFixture("/tmp/engine-view");
    const views: readonly EngineView[] = toEngineViews(
      config,
      new Map<string, EngineRuntimeState>(),
    );
    expect(views).toHaveLength(1);
    expect(views[0]?.health).toBe(EngineHealth.offline);
    expect(views[0]?.running).toBe(0);
  });
});

describe("engine scheduler service", (): void => {
  test("lists engines and records success through the pool port", async (): Promise<void> => {
    const config: PlatformConfig =
      createPlatformConfigFixture("/tmp/engine-svc");
    const views: readonly EngineView[] = await Effect.runPromise(
      EnginePool.pipe(
        Effect.flatMap(
          (pool: EnginePoolShape): Effect.Effect<readonly EngineView[]> =>
            pool
              .recordFailure(TestIdentifier.engine)
              .pipe(
                Effect.andThen(pool.recordSuccess(TestIdentifier.engine)),
                Effect.andThen(pool.list()),
              ),
        ),
        Effect.provide(
          EnginePool.Default.pipe(
            Layer.provide(Layer.succeed(ConfigService, config)),
          ),
        ),
      ),
    );
    expect(views).toHaveLength(1);
    expect(views[0]?.health).toBe(EngineHealth.healthy);
  });

  test("builds the gateway service with the stable-diffusion adapter registered", async (): Promise<void> => {
    const config: PlatformConfig =
      createPlatformConfigFixture("/tmp/engine-gw");
    const result: Either.Either<EngineCapabilities, EngineGatewayError> =
      await Effect.runPromise(
        EngineGateway.pipe(
          Effect.flatMap(
            (
              gateway: EngineGatewayShape,
            ): Effect.Effect<
              Either.Either<EngineCapabilities, EngineGatewayError>
            > =>
              Effect.either(
                gateway.capabilities({
                  ...getFirstEngineFixture(config),
                  url: "http://127.0.0.1:1",
                }),
              ),
          ),
          Effect.provide(
            EngineGateway.Default.pipe(Layer.provide(FetchHttpClient.layer)),
          ),
        ),
      );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe(ErrorTag.engineUnavailable);
    }
  });
});

describe("engine gateway routing", (): void => {
  test("dispatches every operation to the registered adapter", async (): Promise<void> => {
    const config: PlatformConfig =
      createPlatformConfigFixture("/tmp/engine-route");
    const engine: EngineConfig = getFirstEngineFixture(config);
    const gateway: EngineGatewayShape = createEngineGatewayRouter({
      [engine.provider]: RecordingAdapter,
    });
    const capabilities: EngineCapabilities = await Effect.runPromise(
      gateway.capabilities(engine),
    );
    const polled: EngineJob = await Effect.runPromise(
      gateway.poll(engine, TestRemoteJobId.router),
    );
    const cancelled: EngineJob = await Effect.runPromise(
      gateway.cancel(engine, TestRemoteJobId.router),
    );
    const submitted: EngineSubmission = await Effect.runPromise(
      gateway.submit(engine, JobRequestFixture),
    );
    expect(capabilities.supportsImageGeneration).toBe(true);
    expect(polled.id).toBe("poll:remote-1");
    expect(cancelled.id).toBe("cancel:remote-1");
    expect(submitted.id).toBe("submitted");
  });

  test("fails every operation when no adapter is registered", async (): Promise<void> => {
    const config: PlatformConfig =
      createPlatformConfigFixture("/tmp/engine-none");
    const engine: EngineConfig = getFirstEngineFixture(config);
    const gateway: EngineGatewayShape = createEngineGatewayRouter({});
    const outcomes: readonly Either.Either<unknown, EngineGatewayError>[] =
      await Effect.runPromise(
        Effect.all([
          Effect.either(gateway.capabilities(engine)),
          Effect.either(gateway.poll(engine, TestRemoteJobId.router)),
          Effect.either(gateway.cancel(engine, TestRemoteJobId.router)),
        ]),
      );
    for (const outcome of outcomes) {
      expect(Either.isLeft(outcome)).toBe(true);
      if (Either.isLeft(outcome)) {
        expect(outcome.left._tag).toBe(ErrorTag.engineProtocol);
      }
    }
  });
});
