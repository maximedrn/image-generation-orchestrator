import { describe, expect, test } from "bun:test";
import type {
  EngineConfig,
  PlatformConfig,
} from "@app/core/config/config.types";
import { ErrorTag } from "@app/core/errors/error.constants";
import type {
  InvalidRequestError,
  LimitExceededError,
} from "@app/core/errors/error.types";
import {
  JobLimitName,
  JobPublicErrorCode,
  JobStatus,
} from "@app/modules/jobs/job.constants";
import { validateJobLimits } from "@app/modules/jobs/job.helpers";
import { toJobResponse } from "@app/modules/jobs/job.service";
import type {
  Job,
  JobCreateRequest,
  JobResponse,
  JobResult,
} from "@app/modules/jobs/job.types";
import {
  createJobFixture,
  createPlatformConfigFixture,
  JobRequestFixture,
  TestIdentifier,
} from "@test/fixtures/platform.fixture";
import { TestArtefact, TestInstant } from "@test/fixtures/test.constants";
import { Effect, Either } from "effect";

/** Job identifier reused by the public representation assertions. */
const SampleJobId: string = "job-1";

/** Configuration shared by every guardrail assertion. */
const LimitsConfig: PlatformConfig =
  createPlatformConfigFixture("/tmp/job-limits");

/**
 * Validates one request and materializes the typed guardrail failure.
 *
 * @param {Partial<JobCreateRequest>} overrides - Fields replacing the fixture.
 * @param {PlatformConfig} config - Runtime guardrails.
 * @returns {Promise<Either.Either<void, InvalidRequestError | LimitExceededError>>} Outcome.
 */
const validate = (
  overrides: Partial<JobCreateRequest>,
  config: PlatformConfig = LimitsConfig,
): Promise<Either.Either<void, InvalidRequestError | LimitExceededError>> =>
  Effect.runPromise(
    Effect.either(
      validateJobLimits({ ...JobRequestFixture, ...overrides }, config),
    ),
  );

/**
 * Reads the limit name carried by a rejected guardrail outcome.
 *
 * @param {Either.Either<void, InvalidRequestError | LimitExceededError>} outcome - Validation outcome.
 * @returns {string} Limit identifier, or the error tag when it carries none.
 */
const rejectedLimit = (
  outcome: Either.Either<void, InvalidRequestError | LimitExceededError>,
): string => {
  if (Either.isRight(outcome)) return "accepted";
  return "limit" in outcome.left ? outcome.left.limit : outcome.left._tag;
};

describe("job admission guardrails", (): void => {
  test("accepts the reference request unchanged", async (): Promise<void> => {
    expect(rejectedLimit(await validate({}))).toBe("accepted");
  });

  test("rejects a model missing from the registry", async (): Promise<void> => {
    expect(rejectedLimit(await validate({ model: "absent" }))).toBe(
      ErrorTag.invalidRequest,
    );
  });

  test("rejects a registered model no engine is assigned to", async (): Promise<void> => {
    const orphanModel: PlatformConfig = {
      ...LimitsConfig,
      engines: LimitsConfig.engines.map(
        (engine: EngineConfig): EngineConfig => ({
          ...engine,
          models: [],
        }),
      ),
    };
    expect(rejectedLimit(await validate({}, orphanModel))).toBe(
      ErrorTag.invalidRequest,
    );
  });

  test("rejects dimensions above the model ceiling", async (): Promise<void> => {
    expect(rejectedLimit(await validate({ height: 4096, width: 4096 }))).toBe(
      JobLimitName.dimensions,
    );
  });

  test("rejects a pixel count above the global budget", async (): Promise<void> => {
    const tightPixels: PlatformConfig = {
      ...LimitsConfig,
      limits: { ...LimitsConfig.limits, maxPixels: 1024 },
    };
    expect(rejectedLimit(await validate({}, tightPixels))).toBe(
      JobLimitName.pixels,
    );
  });

  test("rejects a step count above the global budget", async (): Promise<void> => {
    expect(rejectedLimit(await validate({ steps: 500 }))).toBe(
      JobLimitName.steps,
    );
  });

  test("rejects a batch above the global budget", async (): Promise<void> => {
    expect(rejectedLimit(await validate({ count: 64 }))).toBe(
      JobLimitName.batch,
    );
  });

  test("rejects a serialized request above the input budget", async (): Promise<void> => {
    expect(rejectedLimit(await validate({ prompt: "x".repeat(70_000) }))).toBe(
      JobLimitName.inputBytes,
    );
  });

  test("rejects an estimated cost above the compute budget", async (): Promise<void> => {
    const tightCost: PlatformConfig = {
      ...LimitsConfig,
      limits: { ...LimitsConfig.limits, maxJobCost: 1 },
    };
    expect(rejectedLimit(await validate({}, tightCost))).toBe(
      JobLimitName.cost,
    );
  });

  test("skips dimension checks for a model absent from the registry", async (): Promise<void> => {
    // The model is assigned to an engine but carries no per-model ceiling.
    const unlistedModel: PlatformConfig = {
      ...LimitsConfig,
      models: {},
    };
    expect(rejectedLimit(await validate({}, unlistedModel))).toBe(
      ErrorTag.invalidRequest,
    );
  });
});

describe("public job representation", (): void => {
  test("exposes result urls only once the job succeeded", (): void => {
    const results: readonly JobResult[] = [
      {
        index: 0,
        jobId: SampleJobId,
        mimeType: TestArtefact.pngMimeType,
        path: "/tmp/job-1-0.png",
        sha256: TestArtefact.digest,
        sizeBytes: 2,
      },
    ];
    const succeeded: Job = {
      ...createJobFixture(SampleJobId),
      status: JobStatus.succeeded,
    };
    const response: JobResponse = toJobResponse(succeeded, results);
    expect(response.resultUrls).toEqual(["/v1/jobs/job-1/results/0"]);
    expect(response.error).toBeNull();
    // A running job with the same metadata must not leak the urls.
    expect(
      toJobResponse(createJobFixture(SampleJobId), results).resultUrls,
    ).toEqual([]);
  });

  test("exposes when the platform started working on the job", (): void => {
    const claimed: Job = {
      ...createJobFixture(SampleJobId),
      startedAt: TestInstant.leaseRenewed,
      status: JobStatus.running,
    };
    const response: JobResponse = toJobResponse(claimed, []);
    expect(response.startedAt).toBe(TestInstant.leaseRenewed);
    // A job still waiting in the queue has not started, and says so.
    expect(
      toJobResponse(createJobFixture(SampleJobId), []).startedAt,
    ).toBeNull();
  });

  test("reports a stable public error for a failed job", (): void => {
    const failed: Job = {
      ...createJobFixture("job-2"),
      errorCode: "SOMETHING_INTERNAL",
      errorMessage: "stack trace that must not leak",
      status: JobStatus.failed,
    };
    const response: JobResponse = toJobResponse(failed, []);
    expect(response.error).not.toBeNull();
    expect(response.error?.code).toBe(JobPublicErrorCode.generationFailed);
    // Internal detail never reaches the public contract.
    expect(JSON.stringify(response)).not.toContain("stack trace");
    expect(response.request.model).toBe(TestIdentifier.model);
  });
});

describe("public progress representation", (): void => {
  test("exposes progress once the engine reports a total", (): void => {
    const running: Job = {
      ...createJobFixture(SampleJobId),
      progressStep: 12,
      progressSteps: 20,
      status: JobStatus.running,
    };
    expect(toJobResponse(running, []).progress).toEqual({
      completed: 12,
      total: 20,
    });
  });

  test("reports no progress for a job that has not started sampling", (): void => {
    expect(
      toJobResponse(createJobFixture(SampleJobId), []).progress,
    ).toBeNull();
  });
});
