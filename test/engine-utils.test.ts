import { describe, expect, test } from "bun:test";

import type { EngineCapabilities } from "@app/engine/engine.types.js";
import { STABLE_DIFFUSION_JOB_KIND } from "@app/engine/stable-diffusion.constants.js";
import type {
  StableDiffusionCapabilities,
  StableDiffusionImageGenerationRequest,
} from "@app/engine/stable-diffusion.types.js";
import {
  toEngineCapabilities,
  toStableDiffusionImageGenerationRequest,
} from "@app/engine/stable-diffusion.utils.js";
import { OUTPUT_FORMAT } from "@app/job/job.constants.js";
import { JOB_REQUEST_FIXTURE } from "@test/platform.fixture.js";

describe("stable-diffusion.cpp request adapter", (): void => {
  test("maps the platform contract to the native async API", (): void => {
    const request: StableDiffusionImageGenerationRequest =
      toStableDiffusionImageGenerationRequest(JOB_REQUEST_FIXTURE);
    expect(request.prompt).toBe(JOB_REQUEST_FIXTURE.prompt);
    expect(request.batch_count).toBe(JOB_REQUEST_FIXTURE.count);
    expect(request.sample_params.sample_steps).toBe(JOB_REQUEST_FIXTURE.steps);
    expect(request.sample_params.guidance.txt_cfg).toBe(
      JOB_REQUEST_FIXTURE.cfgScale,
    );
  });

  test("uses mode-aware native output formats", (): void => {
    const nativeCapabilities: StableDiffusionCapabilities = {
      output_formats_by_mode: {
        [STABLE_DIFFUSION_JOB_KIND.IMAGE_GENERATION]: [
          OUTPUT_FORMAT.PNG,
          OUTPUT_FORMAT.WEBP,
          "unsupported-native-format",
        ],
      },
      supported_modes: [STABLE_DIFFUSION_JOB_KIND.IMAGE_GENERATION],
    };

    const capabilities: EngineCapabilities =
      toEngineCapabilities(nativeCapabilities);

    expect(capabilities.supportsImageGeneration).toBe(true);
    expect(capabilities.outputFormats).toEqual([
      OUTPUT_FORMAT.PNG,
      OUTPUT_FORMAT.WEBP,
    ]);
  });
});
