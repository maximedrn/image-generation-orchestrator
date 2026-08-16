import { describe, expect, test } from "bun:test";

import type { EngineCapabilities } from "@app/infrastructure/engine/engine.types";
import { StableDiffusionJobKind } from "@app/infrastructure/engine/stable-diffusion/stable-diffusion.constants";
import type {
  StableDiffusionCapabilities,
  StableDiffusionImageGenerationRequest,
} from "@app/infrastructure/engine/stable-diffusion/stable-diffusion.types";
import {
  toEngineCapabilities,
  toStableDiffusionImageGenerationRequest,
} from "@app/infrastructure/engine/stable-diffusion/stable-diffusion.utils";
import { OutputFormat } from "@app/modules/jobs/job.constants";
import { JobRequestFixture } from "@test/fixtures/platform.fixture";

describe("stable-diffusion.cpp request adapter", (): void => {
  test("maps the platform contract to the native async API", (): void => {
    const request: StableDiffusionImageGenerationRequest =
      toStableDiffusionImageGenerationRequest(JobRequestFixture);
    expect(request.prompt).toBe(JobRequestFixture.prompt);
    expect(request.batch_count).toBe(JobRequestFixture.count);
    expect(request.sample_params.sample_steps).toBe(JobRequestFixture.steps);
    expect(request.sample_params.guidance.txt_cfg).toBe(
      JobRequestFixture.cfgScale,
    );
  });

  test("uses mode-aware native output formats", (): void => {
    const nativeCapabilities: StableDiffusionCapabilities = {
      output_formats_by_mode: {
        [StableDiffusionJobKind.imageGeneration]: [
          OutputFormat.png,
          OutputFormat.webp,
          "unsupported-native-format",
        ],
      },
      supported_modes: [StableDiffusionJobKind.imageGeneration],
    };

    const capabilities: EngineCapabilities =
      toEngineCapabilities(nativeCapabilities);

    expect(capabilities.supportsImageGeneration).toBe(true);
    expect(capabilities.outputFormats).toEqual([
      OutputFormat.png,
      OutputFormat.webp,
    ]);
  });
});
