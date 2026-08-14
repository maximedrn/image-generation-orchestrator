import { describe, expect, test } from "bun:test";

import { JOB_STATUS } from "@app/job/job.constants.js";
import { canTransitionJob, computeJobCost } from "@app/job/job.utils.js";
import { JOB_REQUEST_FIXTURE } from "@test/platform.fixture.js";

describe("job utilities", (): void => {
  test("computes deterministic queue cost", (): void => {
    expect(computeJobCost(JOB_REQUEST_FIXTURE)).toBe(5_242_880);
  });

  test("accepts only state-machine transitions", (): void => {
    expect(canTransitionJob(JOB_STATUS.QUEUED, JOB_STATUS.RUNNING)).toBe(true);
    expect(canTransitionJob(JOB_STATUS.RUNNING, JOB_STATUS.SUCCEEDED)).toBe(true);
    expect(canTransitionJob(JOB_STATUS.SUCCEEDED, JOB_STATUS.RUNNING)).toBe(false);
  });
});
