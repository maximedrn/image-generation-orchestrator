import { afterEach, describe, expect, test } from "bun:test";
import { EngineUnavailableError } from "@app/core/errors/error.types";
import type {
  EngineGatewayError,
  EngineGatewayShape,
} from "@app/infrastructure/engine/engine.interface";
import type { EngineCapabilities } from "@app/infrastructure/engine/engine.types";
import { countReadyEngines } from "@app/modules/health/health.helpers";
import {
  completedRemoteJob,
  createWorkerHarness,
  type WorkerHarness,
} from "@test/fixtures/dispatcher-worker.fixture";
import { Effect } from "effect";

/** Harnesses opened by the running test. */
const OpenHarnesses: WorkerHarness[] = [];

/**
 * Opens one tracked harness so the database is always closed afterwards.
 *
 * @param {Parameters<typeof createWorkerHarness>[0]} options - Scenario options.
 * @returns {WorkerHarness} Tracked worker harness.
 */
const openHarness = (
  options: Parameters<typeof createWorkerHarness>[0],
): WorkerHarness => {
  const harness: WorkerHarness = createWorkerHarness(options);
  OpenHarnesses.push(harness);
  return harness;
};

afterEach((): void => {
  for (const harness of OpenHarnesses.splice(0)) {
    harness.database.client.close();
  }
});

describe("engine readiness probing", (): void => {
  test("counts an engine that fails its capability probe as unusable", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: { responses: [completedRemoteJob()] },
    });
    const failingGateway: EngineGatewayShape = {
      ...harness.dependencies.gateway,
      capabilities: (): Effect.Effect<EngineCapabilities, EngineGatewayError> =>
        Effect.fail(new EngineUnavailableError({ message: "probe refused" })),
    };
    const ready: number = await Effect.runPromise(
      countReadyEngines(
        harness.config.engines,
        failingGateway,
        harness.dependencies.pool,
      ),
    );
    expect(ready).toBe(0);
    expect(harness.poolCalls.failure).toBe(1);
  });
});
