import { describe, expect, test } from "bun:test";
import { Effect, Option, Ref } from "effect";

import type { PlatformConfig } from "@app/config/config.types.js";
import { createEnginePool, createInitialState } from "@app/engine/engine-pool.service.js";
import type { EnginePoolShape } from "@app/engine/engine.interface.js";
import type {
  EngineReservation,
  EngineRuntimeState,
} from "@app/engine/engine.types.js";
import {
  createPlatformConfigFixture,
  TEST_ENGINE_ID,
  TEST_MODEL_ID,
} from "@test/platform.fixture.js";

/** Result of one scheduler reserve/release lifecycle. */
interface ReservationLifecycleResult {
  readonly availableAgain: Option.Option<EngineReservation>;
  readonly reservation: Option.Option<EngineReservation>;
  readonly unavailable: Option.Option<EngineReservation>;
}

/**
 * Executes one deterministic engine capacity lifecycle.
 *
 * @param config - (PlatformConfig) Scheduler configuration.
 * @returns (Effect.Effect<ReservationLifecycleResult>) Lifecycle result.
 */
const runReservationLifecycle = (
  config: PlatformConfig,
): Effect.Effect<ReservationLifecycleResult> =>
  Effect.gen(function* reservationLifecycleEffect(): Generator<
    unknown,
    ReservationLifecycleResult
  > {
    const state: Ref.Ref<ReadonlyMap<string, EngineRuntimeState>> =
      yield* Ref.make(createInitialState(config.engines));
    const pool: EnginePoolShape = createEnginePool(config, state);
    const reservation: Option.Option<EngineReservation> =
      yield* pool.reserve(TEST_MODEL_ID);
    const unavailable: Option.Option<EngineReservation> =
      yield* pool.reserve(TEST_MODEL_ID);
    if (Option.isSome(reservation)) {
      yield* pool.release(reservation.value.engine.id);
    }
    const availableAgain: Option.Option<EngineReservation> =
      yield* pool.reserveById(TEST_ENGINE_ID, TEST_MODEL_ID);
    return { availableAgain, reservation, unavailable };
  });

/**
 * Opens a circuit and attempts one new reservation.
 *
 * @param config - (PlatformConfig) Scheduler configuration.
 * @returns (Effect.Effect<Option.Option<EngineReservation>>) Reservation result.
 */
const reserveAfterCircuitOpen = (
  config: PlatformConfig,
): Effect.Effect<Option.Option<EngineReservation>> =>
  Effect.gen(function* circuitBreakerTestEffect(): Generator<
    unknown,
    Option.Option<EngineReservation>
  > {
    const state: Ref.Ref<ReadonlyMap<string, EngineRuntimeState>> =
      yield* Ref.make(createInitialState(config.engines));
    const pool: EnginePoolShape = createEnginePool(config, state);
    yield* pool.recordFailure(TEST_ENGINE_ID);
    yield* pool.recordFailure(TEST_ENGINE_ID);
    yield* pool.recordFailure(TEST_ENGINE_ID);
    return yield* pool.reserve(TEST_MODEL_ID);
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
