import { ClientIp } from "@app/core/http/client-ip.decorator";
import { HttpParameter, HttpRoute } from "@app/core/http/http.constants";
import { HttpEffectService } from "@app/core/http/http-effect.service";
import { SchemaValidationPipe } from "@app/core/http/schema-validation.pipe";
import { BearerAuthGuard } from "@app/core/security/bearer-auth.guard";
import { JobMessage } from "@app/modules/jobs/job.constants";
import type {
  JobServiceError,
  JobServiceShape,
} from "@app/modules/jobs/job.interface";
import { JobCreateRequestSchema } from "@app/modules/jobs/job.schema";
import { JobService } from "@app/modules/jobs/job.service";
import type {
  JobCreateRequest,
  JobResponse,
} from "@app/modules/jobs/job.types";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Effect } from "effect";

/** Public job HTTP adapter. Business logic remains inside Effect services. */
@Controller(HttpRoute.jobCollection)
@UseGuards(BearerAuthGuard)
class JobController {
  readonly #httpEffect: HttpEffectService;

  /**
   * Creates the job HTTP adapter.
   *
   * @param {HttpEffectService} httpEffect - Typed Effect/HTTP bridge.
   */
  constructor(httpEffect: HttpEffectService) {
    this.#httpEffect = httpEffect;
  }

  /**
   * Accepts one generation request into the durable queue.
   *
   * @param {JobCreateRequest} body - Request body decoded at the boundary.
   * @param {string} clientIp - Caller address used only for rate limiting.
   * @returns {Promise<JobResponse>} Newly queued job.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(
      new SchemaValidationPipe(
        JobCreateRequestSchema,
        JobMessage.invalidRequest,
      ),
    )
    body: JobCreateRequest,
    @ClientIp() clientIp: string,
  ): Promise<JobResponse> {
    return this.#httpEffect.run(
      Effect.flatMap(
        JobService,
        (
          service: JobServiceShape,
        ): Effect.Effect<JobResponse, JobServiceError> =>
          service.submit(body, clientIp),
      ),
    );
  }

  /**
   * Returns one durable job and available result URLs.
   *
   * @param {string} id - Job identifier.
   * @returns {Promise<JobResponse>} Current job state.
   */
  @Get(HttpRoute.jobId)
  get(@Param(HttpParameter.jobId) id: string): Promise<JobResponse> {
    return this.#httpEffect.run(
      Effect.flatMap(
        JobService,
        (
          service: JobServiceShape,
        ): Effect.Effect<JobResponse, JobServiceError> => service.get(id),
      ),
    );
  }

  /**
   * Cancels a queued job or durably requests cancellation of a running job.
   *
   * @param {string} id - Job identifier.
   * @returns {Promise<JobResponse>} Updated durable job state.
   */
  @Delete(HttpRoute.jobId)
  @HttpCode(HttpStatus.ACCEPTED)
  cancel(@Param(HttpParameter.jobId) id: string): Promise<JobResponse> {
    return this.#httpEffect.run(
      Effect.flatMap(
        JobService,
        (
          service: JobServiceShape,
        ): Effect.Effect<JobResponse, JobServiceError> => service.cancel(id),
      ),
    );
  }
}

export { JobController };
