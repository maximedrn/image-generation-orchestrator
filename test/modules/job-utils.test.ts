import { describe, expect, test } from "bun:test";

import { JobStatus } from "@app/modules/jobs/job.constants";
import { canTransitionJob, computeJobCost } from "@app/modules/jobs/job.utils";
import { JobRequestFixture } from "@test/fixtures/platform.fixture";

describe("job utilities", (): void => {
  test("computes deterministic queue cost", (): void => {
    expect(computeJobCost(JobRequestFixture)).toBe(5_242_880);
  });

  test("accepts only state-machine transitions", (): void => {
    expect(canTransitionJob(JobStatus.queued, JobStatus.running)).toBe(true);
    expect(canTransitionJob(JobStatus.running, JobStatus.succeeded)).toBe(true);
    expect(canTransitionJob(JobStatus.succeeded, JobStatus.running)).toBe(
      false,
    );
  });
});
