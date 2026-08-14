import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Effect } from "effect";
import type { FastifyRequest } from "fastify";

import { HTTP_PARAMETER, HTTP_ROUTE } from "@app/http/http.constants.js";
import { HttpEffectService } from "@app/http/http-effect.service.js";
import type { JobServiceError, JobServiceShape } from "@app/job/job.interface.js";
import { JobService } from "@app/job/job.service.js";
import type { JobResponse } from "@app/job/job.types.js";
import { BearerAuthGuard } from "@app/security/bearer-auth.guard.js";

/** Public job HTTP adapter. Business logic remains inside Effect services. */
@Controller(HTTP_ROUTE.JOB_COLLECTION)
@UseGuards(BearerAuthGuard)
class JobController {
  readonly #httpEffect: HttpEffectService;

  /**
   * Creates the job HTTP adapter.
   *
   * @param httpEffect - (HttpEffectService) Typed Effect/HTTP bridge.
   */
  constructor(httpEffect: HttpEffectService) {
    this.#httpEffect = httpEffect;
  }

  /**
   * Accepts one generation request into the durable queue.
   *
   * @param body - (unknown) Untrusted JSON request body.
   * @param request - (FastifyRequest) Request metadata used only for rate limiting.
   * @returns (Promise<JobResponse>) Newly queued job.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() body: unknown, @Req() request: FastifyRequest): Promise<JobResponse> {
    return this.#httpEffect.run(
      Effect.flatMap(JobService, (service: JobServiceShape): Effect.Effect<JobResponse, JobServiceError> =>
        service.submit(body, request.ip),
      ),
    );
  }

  /**
   * Returns one durable job and available result URLs.
   *
   * @param id - (string) Job identifier.
   * @returns (Promise<JobResponse>) Current job state.
   */
  @Get(HTTP_ROUTE.JOB_ID)
  get(@Param(HTTP_PARAMETER.JOB_ID) id: string): Promise<JobResponse> {
    return this.#httpEffect.run(
      Effect.flatMap(JobService, (service: JobServiceShape): Effect.Effect<JobResponse, JobServiceError> => service.get(id)),
    );
  }

  /**
   * Cancels a queued job or durably requests cancellation of a running job.
   *
   * @param id - (string) Job identifier.
   * @returns (Promise<JobResponse>) Updated durable job state.
   */
  @Delete(HTTP_ROUTE.JOB_ID)
  @HttpCode(HttpStatus.ACCEPTED)
  cancel(@Param(HTTP_PARAMETER.JOB_ID) id: string): Promise<JobResponse> {
    return this.#httpEffect.run(
      Effect.flatMap(JobService, (service: JobServiceShape): Effect.Effect<JobResponse, JobServiceError> =>
        service.cancel(id),
      ),
    );
  }
}

export { JobController };
