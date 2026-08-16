import type {
  EngineConfig,
  PlatformConfig,
} from "@app/core/config/config.types";
import { createAppRuntime } from "@app/core/runtime/runtime.factory";
import type { AppRuntime } from "@app/core/runtime/runtime.types";
import { EngineJobStatus } from "@app/infrastructure/engine/engine.constants";
import type {
  EngineGatewayError,
  EngineGatewayShape,
} from "@app/infrastructure/engine/engine.interface";
import { EngineGateway } from "@app/infrastructure/engine/engine.service";
import type {
  EngineCapabilities,
  EngineJob,
  EngineSubmission,
} from "@app/infrastructure/engine/engine.types";
import { OutputFormat } from "@app/modules/jobs/job.constants";
import type { OutputFormatValue } from "@app/modules/jobs/job.types";
import { createPlatformConfigFixture } from "@test/fixtures/platform.fixture";
import {
  TestImagePayload,
  TestRemoteJobId,
} from "@test/fixtures/test.constants";
import { Effect, Layer } from "effect";

/** Remote identifier the fake engine hands back for every submission. */
const FakeRemoteJobId: string = TestRemoteJobId.endToEnd;

/** Engine behaviour a scenario needs from the fake inference backend. */
interface EngineBehaviour {
  /** Formats advertised by the capabilities probe. */
  readonly outputFormats?: readonly OutputFormatValue[];
  /** Whether the engine claims to support image generation at all. */
  readonly supportsImageGeneration?: boolean;
}

/** One disposable application runtime plus everything a test needs to drive it. */
interface RuntimeHarness {
  readonly config: PlatformConfig;
  readonly dispose: () => Promise<void>;
  readonly runtime: AppRuntime;
  readonly storageRoot: string;
}

/**
 * Builds a fake provider adapter so no real engine is ever contacted.
 *
 * @param {EngineBehaviour} behaviour - Capabilities the fake engine reports.
 * @returns {Layer.Layer<EngineGateway>} Fully provided gateway layer.
 */
const createFakeGatewayLayer = (
  behaviour: EngineBehaviour,
): Layer.Layer<EngineGateway> => {
  const terminalJob: EngineJob = {
    error: null,
    id: FakeRemoteJobId,
    result: {
      images: [{ base64: TestImagePayload.short, index: 0 }],
      outputFormat: OutputFormat.png,
    },
    status: EngineJobStatus.succeeded,
  };
  const gateway: EngineGatewayShape = {
    cancel: (): Effect.Effect<EngineJob, EngineGatewayError> =>
      Effect.succeed({ ...terminalJob, status: EngineJobStatus.cancelled }),
    capabilities: (): Effect.Effect<EngineCapabilities, EngineGatewayError> =>
      Effect.succeed({
        outputFormats: [...(behaviour.outputFormats ?? [OutputFormat.png])],
        supportsImageGeneration: behaviour.supportsImageGeneration ?? true,
      }),
    poll: (): Effect.Effect<EngineJob, EngineGatewayError> =>
      Effect.succeed(terminalJob),
    submit: (): Effect.Effect<EngineSubmission, EngineGatewayError> =>
      Effect.succeed({ id: FakeRemoteJobId }),
  };
  return Layer.succeed(EngineGateway, gateway as EngineGateway);
};

/** Knobs a scenario uses to shape its runtime. */
interface RuntimeOptions {
  readonly engine?: EngineBehaviour;
  /** Left at zero so the background dispatcher never claims a queued job. */
  readonly maxRunningJobs?: number;
}

/**
 * Builds one real application runtime over a disposable storage directory.
 *
 * Every port is the production implementation except the engine gateway, so
 * the database, repository, storage and job services are exercised for real.
 *
 * @param {RuntimeOptions} options - Scenario-specific behaviour.
 * @returns {RuntimeHarness} Runtime plus its disposal hook.
 */
const createRuntimeHarness = (options: RuntimeOptions = {}): RuntimeHarness => {
  const storageRoot: string = `/tmp/platform-e2e-${crypto.randomUUID()}`;
  const base: PlatformConfig = createPlatformConfigFixture(storageRoot);
  const engines: readonly EngineConfig[] = base.engines;
  const config: PlatformConfig = {
    ...base,
    engines,
    queue: {
      ...base.queue,
      maxRunningJobs: options.maxRunningJobs ?? 0,
      pollIntervalMs: 5,
      recoveryIntervalSeconds: 60,
    },
  };
  const runtime: AppRuntime = createAppRuntime(config, {
    engineGateway: createFakeGatewayLayer(options.engine ?? {}),
  });
  return {
    config,
    dispose: (): Promise<void> => runtime.dispose(),
    runtime,
    storageRoot,
  };
};

export type { EngineBehaviour, RuntimeHarness };
export { createFakeGatewayLayer, createRuntimeHarness, FakeRemoteJobId };
