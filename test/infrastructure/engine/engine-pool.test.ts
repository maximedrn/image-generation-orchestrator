import { describe, expect, test } from "bun:test";
import type { PlatformConfig } from "@app/core/config/config.types";
import type { EnginePoolShape } from "@app/infrastructure/engine/engine.interface";
import type {
  EngineReservation,
  EngineRuntimeState,
} from "@app/infrastructure/engine/engine.types";
import { createEnginePool } from "@app/infrastructure/engine/pool/engine-pool.factory";
import { createInitialEngineState } from "@app/infrastructure/engine/pool/engine-pool.helpers";
import {
  createPlatformConfigFixture,
  TestIdentifier,
} from "@test/fixtures/platform.fixture";
import { Effect, Option, Ref } from "effect";

/** Result of one scheduler reserve/release lifecycle. */
interface ReservationLifecycleResult {
  readonly availableAgain: Option.Option<EngineReservation>;
  readonly reservation: Option.Option<EngineReservation>;
  readonly unavailable: Option.Option<EngineReservation>;
}

/**
 * Executes one deterministic engine capacity lifecycle.
 *
 * @param {PlatformConfig} config - Scheduler configuration.
 * @returns {Effect.Effect<ReservationLifecycleResult>} Lifecycle result.
 */
const runReservationLifecycle = (
  config: PlatformConfig,
): Effect.Effect<ReservationLifecycleResult> =>
  Effect.gen(function* reservationLifecycleEffect() {
    const state: Ref.Ref<ReadonlyMap<string, EngineRuntimeState>> =
      yield* Ref.make(createInitialEngineState(config.engines));
    const pool: EnginePoolShape = createEnginePool(config, state);
    const reservation: Option.Option<EngineReservation> = yield* pool.reserve(
      TestIdentifier.model,
    );
    const unavailable: Option.Option<EngineReservation> = yield* pool.reserve(
      TestIdentifier.model,
    );
    if (Option.isSome(reservation)) {
      yield* pool.release(reservation.value.engine.id);
    }
    const availableAgain: Option.Option<EngineReservation> =
      yield* pool.reserveById(TestIdentifier.engine, TestIdentifier.model);
    return { availableAgain, reservation, unavailable };
  });

/**
 * Opens a circuit and attempts one new reservation.
 *
 * @param {PlatformConfig} config - Scheduler configuration.
 * @returns {Effect.Effect<Option.Option<EngineReservation>>} Reservation result.
 */
const reserveAfterCircuitOpen = (
  config: PlatformConfig,
): Effect.Effect<Option.Option<EngineReservation>> =>
  Effect.gen(function* circuitBreakerTestEffect() {
    const state: Ref.Ref<ReadonlyMap<string, EngineRuntimeState>> =
      yield* Ref.make(createInitialEngineState(config.engines));
    const pool: EnginePoolShape = createEnginePool(config, state);
    yield* pool.recordFailure(TestIdentifier.engine);
    yield* pool.recordFailure(TestIdentifier.engine);
    yield* pool.recordFailure(TestIdentifier.engine);
    return yield* pool.reserve(TestIdentifier.model);
  });

describe("engine pool", (): void => {
  test("reserves capacity and releases the same slot", async (): Promise<void> => {
    const config: PlatformConfig = createPlatformConfigFixture(
      "/tmp/engine-pool-test",
    );
    const result: ReservationLifecycleResult = await Effect.runPromise(
      runReservationLifecycle(config),
    );
    expect(Option.isSome(result.reservation)).toBe(true);
    expect(Option.isNone(result.unavailable)).toBe(true);
    expect(Option.isSome(result.availableAgain)).toBe(true);
  });

  test("opens the circuit after the configured failure threshold", async (): Promise<void> => {
    const config: PlatformConfig = createPlatformConfigFixture(
      "/tmp/engine-pool-circuit",
    );
    const result: Option.Option<EngineReservation> = await Effect.runPromise(
      reserveAfterCircuitOpen(config),
    );
    expect(Option.isNone(result)).toBe(true);
  });
});
