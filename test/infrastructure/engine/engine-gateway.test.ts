import { describe, expect, test } from "bun:test";
import type {
  EngineConfig,
  PlatformConfig,
} from "@app/core/config/config.types";
import { ErrorTag } from "@app/core/errors/error.constants";
import { EngineJobStatus } from "@app/infrastructure/engine/engine.constants";
import { createEngineGatewayRouter } from "@app/infrastructure/engine/engine.factory";
import type {
  EngineGatewayError,
  EngineGatewayShape,
} from "@app/infrastructure/engine/engine.interface";
import type {
  EngineCapabilities,
  EngineJob,
  EngineSubmission,
} from "@app/infrastructure/engine/engine.types";
import { StableDiffusionJobAction } from "@app/infrastructure/engine/stable-diffusion/stable-diffusion.constants";
import { stableDiffusionJobPath } from "@app/infrastructure/engine/stable-diffusion/stable-diffusion.service";
import type { JobCreateRequest } from "@app/modules/jobs/job.types";
import {
  createPlatformConfigFixture,
  getFirstEngineFixture,
  JobRequestFixture,
} from "@test/fixtures/platform.fixture";
import { TestRemoteJobId } from "@test/fixtures/test.constants";
import { Effect, Either } from "effect";

/** Deterministic provider-neutral gateway used to test adapter routing. */
const FakeGateway: EngineGatewayShape = {
  cancel: (
    _engine: EngineConfig,
    remoteJobId: string,
  ): Effect.Effect<EngineJob> =>
    Effect.succeed({
      error: null,
      id: remoteJobId,
      result: null,
      status: EngineJobStatus.cancelled,
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
      status: EngineJobStatus.running,
    }),
  submit: (
    _engine: EngineConfig,
    _request: JobCreateRequest,
  ): Effect.Effect<EngineSubmission> =>
    Effect.succeed({ id: TestRemoteJobId.router }),
};

describe("engine gateway router", (): void => {
  test("encodes native job identifiers before path interpolation", (): void => {
    const path: string = stableDiffusionJobPath(
      "job/with space",
      StableDiffusionJobAction.cancel,
    );
    expect(path).toBe("/sdcpp/v1/jobs/job%2Fwith%20space/cancel");
  });
  test("routes an engine to its registered provider adapter", async (): Promise<void> => {
    const config: PlatformConfig =
      createPlatformConfigFixture("/tmp/engine-router");
    const engine: EngineConfig = getFirstEngineFixture(config);
    const gateway: EngineGatewayShape = createEngineGatewayRouter({
      [engine.provider]: FakeGateway,
    });
    const submission: EngineSubmission = await Effect.runPromise(
      gateway.submit(engine, JobRequestFixture),
    );
    expect(submission.id).toBe(TestRemoteJobId.router);
  });

  test("fails explicitly when no adapter is registered", async (): Promise<void> => {
    const config: PlatformConfig = createPlatformConfigFixture(
      "/tmp/engine-router-missing",
    );
    const engine: EngineConfig = getFirstEngineFixture(config);
    const gateway: EngineGatewayShape = createEngineGatewayRouter({});
    const result: Either.Either<EngineSubmission, EngineGatewayError> =
      await Effect.runPromise(
        Effect.either(gateway.submit(engine, JobRequestFixture)),
      );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe(ErrorTag.engineProtocol);
    }
  });
});
