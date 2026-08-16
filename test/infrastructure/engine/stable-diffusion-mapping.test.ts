import { describe, expect, test } from "bun:test";
import { EngineJobStatus } from "@app/infrastructure/engine/engine.constants";
import type { EngineJob } from "@app/infrastructure/engine/engine.types";
import {
  StableDiffusionJobKind,
  StableDiffusionJobStatus,
} from "@app/infrastructure/engine/stable-diffusion/stable-diffusion.constants";
import type {
  StableDiffusionJob,
  StableDiffusionJobStatusValue,
} from "@app/infrastructure/engine/stable-diffusion/stable-diffusion.types";
import {
  toEngineImageResult,
  toEngineImageResultSet,
  toEngineJob,
  toEngineJobStatus,
} from "@app/infrastructure/engine/stable-diffusion/stable-diffusion.utils";
import { OutputFormat } from "@app/modules/jobs/job.constants";
import {
  TestImagePayload,
  TestRemoteJobId,
} from "@test/fixtures/test.constants";

/** Native job payload satisfying the decoded stable-diffusion.cpp contract. */
const NativeJobFixture: StableDiffusionJob = {
  completed: null,
  created: 1,
  error: null,
  id: TestRemoteJobId.adapter,
  kind: StableDiffusionJobKind.imageGeneration,
  queue_position: 0,
  result: null,
  started: null,
  status: StableDiffusionJobStatus.generating,
};

describe("stable-diffusion.cpp payload mapping", (): void => {
  test("maps every native status onto the neutral state machine", (): void => {
    const mapped: readonly string[] = [
      StableDiffusionJobStatus.cancelled,
      StableDiffusionJobStatus.completed,
      StableDiffusionJobStatus.failed,
      StableDiffusionJobStatus.generating,
      StableDiffusionJobStatus.queued,
    ].map((status: StableDiffusionJobStatusValue): string =>
      toEngineJobStatus(status),
    );
    expect(mapped).toEqual([
      EngineJobStatus.cancelled,
      EngineJobStatus.succeeded,
      EngineJobStatus.failed,
      EngineJobStatus.running,
      EngineJobStatus.queued,
    ]);
  });

  test("renames the native base64 member to the neutral contract", (): void => {
    expect(
      toEngineImageResult({ b64_json: TestImagePayload.short, index: 3 }),
    ).toEqual({
      base64: TestImagePayload.short,
      index: 3,
    });
  });

  test("keeps a null native result null instead of inventing a set", (): void => {
    expect(toEngineImageResultSet(null)).toBeNull();
  });

  test("maps a completed native job with its decoded images", (): void => {
    const completed: StableDiffusionJob = {
      ...NativeJobFixture,
      result: {
        images: [{ b64_json: TestImagePayload.short, index: 0 }],
        output_format: OutputFormat.png,
      },
      status: StableDiffusionJobStatus.completed,
    };
    const job: EngineJob = toEngineJob(completed);
    expect(job.status).toBe(EngineJobStatus.succeeded);
    expect(job.result?.outputFormat).toBe(OutputFormat.png);
    expect(job.result?.images).toEqual([
      { base64: TestImagePayload.short, index: 0 },
    ]);
  });

  test("passes a native structured error through untouched", (): void => {
    const failed: StableDiffusionJob = {
      ...NativeJobFixture,
      error: { code: "OOM", message: "out of memory" },
      status: StableDiffusionJobStatus.failed,
    };
    const job: EngineJob = toEngineJob(failed);
    expect(job.status).toBe(EngineJobStatus.failed);
    expect(job.error?.code).toBe("OOM");
  });
});

describe("sampling progress mapping", (): void => {
  test("carries the progress an engine reports", (): void => {
    const job: EngineJob = toEngineJob({
      ...NativeJobFixture,
      progress_step: 24,
      progress_steps: 40,
    });
    expect(job.progress).toEqual({ completed: 24, total: 40 });
  });

  test("reports nothing for an engine built without the progress patch", (): void => {
    // Both fields absent: the adapter must stay usable against a stock build.
    expect(toEngineJob(NativeJobFixture).progress).toBeUndefined();
  });

  test("reports nothing while the total is still unknown", (): void => {
    // A total of zero is "not sampling yet", not "zero percent done".
    const job: EngineJob = toEngineJob({
      ...NativeJobFixture,
      progress_step: 0,
      progress_steps: 0,
    });
    expect(job.progress).toBeUndefined();
  });
});
