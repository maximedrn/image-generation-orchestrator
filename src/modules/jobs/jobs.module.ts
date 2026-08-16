import { JobController } from "@app/modules/jobs/controllers/job.controller";
import { ResultController } from "@app/modules/jobs/controllers/result.controller";
import { Module } from "@nestjs/common";

/** Public job admission, inspection, cancellation and result streaming. */
@Module({ controllers: [JobController, ResultController] })
class JobsModule {}

export { JobsModule };
