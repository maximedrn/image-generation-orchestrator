import { describe, expect, test } from "bun:test";
import type { PlatformConfig } from "@app/core/config/config.types";
import { RuntimeToken } from "@app/core/runtime/runtime.constants";
import { createAppRuntime } from "@app/core/runtime/runtime.factory";
import { EffectRuntimeService } from "@app/core/runtime/runtime.service";
import type { AppRuntime } from "@app/core/runtime/runtime.types";
import { createFakeGatewayLayer } from "@test/fixtures/app-runtime.fixture";
import { createPlatformConfigFixture } from "@test/fixtures/platform.fixture";
import { Effect } from "effect";

describe("nest runtime bridge", (): void => {
  test("runs an effect and disposes the runtime on shutdown", async (): Promise<void> => {
    const config: PlatformConfig = createPlatformConfigFixture(
      `/tmp/platform-bridge-${crypto.randomUUID()}`,
    );
    const runtime: AppRuntime = createAppRuntime(config, {
      engineGateway: createFakeGatewayLayer({}),
    });
    const bridge: EffectRuntimeService = new EffectRuntimeService(runtime);
    const value: number = await bridge.run(
      Effect.succeed(41).pipe(
        Effect.map((current: number): number => current + 1),
      ),
    );
    expect(value).toBe(42);
    expect(RuntimeToken.effectRuntime).toBeDefined();
    // Shutdown must dispose the managed runtime exactly once.
    await bridge.onApplicationShutdown();
  });
});
