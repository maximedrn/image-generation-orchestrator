import { describe, expect, test } from "bun:test";
import { Effect, Either } from "effect";

import type { EngineConfig, PlatformConfig } from "@app/config/config.types.js";
import { createEngineGatewayRouter } from "@app/engine/engine.factory.js";
import type {
  EngineGatewayError,
  EngineGatewayShape,
} from "@app/engine/engine.interface.js";
import { ENGINE_JOB_STATUS } from "@app/engine/engine.constants.js";
import {
  STABLE_DIFFUSION_JOB_ACTION,
} from "@app/engine/stable-diffusion.constants.js";
import { stableDiffusionJobPath } from "@app/engine/stable-diffusion.service.js";
import type {
  EngineCapabilities,
  EngineJob,
  EngineSubmission,
} from "@app/engine/engine.types.js";
import type { JobCreateRequest } from "@app/job/job.types.js";
import {
  createPlatformConfigFixture,
  getFirstEngineFixture,
  JOB_REQUEST_FIXTURE,
} from "@test/platform.fixture.js";

/** Deterministic provider-neutral gateway used to test adapter routing. */
const FAKE_GATEWAY: EngineGatewayShape = {
  cancel: (
    _engine: EngineConfig,
    remoteJobId: string,
  ): Effect.Effect<EngineJob> =>
    Effect.succeed({
      error: null,
      id: remoteJobId,
      result: null,
      status: ENGINE_JOB_STATUS.CANCELLED,
    }),
  capabilities: (_engine: EngineConfig): Effect.Effect<EngineCapabilities> =>
    Effect.succeed({ outputFormats: [], supportsImageGeneration: true }),
  poll: (
    _engine: EngineConfig,
    remoteJobId: string,
  ): Effect.Effect<EngineJob> =>
    Effect.succeed({
      error: null,
      id: remoteJobId,
      result: null,
      status: ENGINE_JOB_STATUS.RUNNING,
    }),
  submit: (
    _engine: EngineConfig,
    _request: JobCreateRequest,
  ): Effect.Effect<EngineSubmission> => Effect.succeed({ id: "remote-1" }),
};

describe("engine gateway router", (): void => {

  test("encodes native job identifiers before path interpolation", (): void => {
    const path: string = stableDiffusionJobPath(
      "job/with space",
      STABLE_DIFFUSION_JOB_ACTION.CANCEL,
    );
    expect(path).toBe("/sdcpp/v1/jobs/job%2Fwith%20space/cancel");
  });
  test("routes an engine to its registered provider adapter", async (): Promise<void> => {
    const config: PlatformConfig = createPlatformConfigFixture("/tmp/engine-router");
    const engine: EngineConfig = getFirstEngineFixture(config);
    const gateway: EngineGatewayShape = createEngineGatewayRouter({
      [engine.provider]: FAKE_GATEWAY,
    });
    const submission: EngineSubmission = await Effect.runPromise(
      gateway.submit(engine, JOB_REQUEST_FIXTURE),
    );
    expect(submission.id).toBe("remote-1");
  });

  test("fails explicitly when no adapter is registered", async (): Promise<void> => {
    const config: PlatformConfig = createPlatformConfigFixture(
      "/tmp/engine-router-missing",
    );
    const engine: EngineConfig = getFirstEngineFixture(config);
    const gateway: EngineGatewayShape = createEngineGatewayRouter({});
    const result: Either.Either<EngineSubmission, EngineGatewayError> =
      await Effect.runPromise(
        Effect.either(gateway.submit(engine, JOB_REQUEST_FIXTURE)),
      );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("EngineProtocolError");
    }
  });
});
