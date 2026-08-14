import { Controller, Get, Param, Res, UseGuards } from "@nestjs/common";
import { Effect } from "effect";
import type { FastifyReply } from "fastify";

import {
  HTTP_HEADER,
  HTTP_PARAMETER,
  HTTP_ROUTE,
  RESULT_CACHE_CONTROL,
} from "@app/http/http.constants.js";
import { HttpEffectService } from "@app/http/http-effect.service.js";
import { parseNonNegativeInteger } from "@app/http/http.helpers.js";
import type { JobServiceShape } from "@app/job/job.interface.js";
import { JobService } from "@app/job/job.service.js";
import type { JobResult } from "@app/job/job.types.js";
import { BearerAuthGuard } from "@app/security/bearer-auth.guard.js";
import type {
  ResultStorageShape,
  StoredResult,
} from "@app/storage/storage.interface.js";
import { ResultStorage } from "@app/storage/storage.service.js";

/** Protected binary result HTTP adapter. */
@Controller(HTTP_ROUTE.JOB_COLLECTION)
@UseGuards(BearerAuthGuard)
class ResultController {
  readonly #httpEffect: HttpEffectService;

  /**
   * Creates the result HTTP adapter.
   *
   * @param httpEffect - (HttpEffectService) Typed Effect/HTTP bridge.
   */
  constructor(httpEffect: HttpEffectService) {
    this.#httpEffect = httpEffect;
  }

  /**
   * Streams one generated result from durable storage without buffering the whole file.
   *
   * @param id - (string) Job identifier.
   * @param indexText - (string) Result index URL parameter.
   * @param reply - (FastifyReply) Fastify response adapter.
   * @returns (Promise<void>) Completes after Fastify owns the binary response.
   */
  @Get(HTTP_ROUTE.RESULT)
  async getResult(
    @Param(HTTP_PARAMETER.JOB_ID) id: string,
    @Param(HTTP_PARAMETER.RESULT_INDEX) indexText: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const stored: StoredResult = await this.#httpEffect.run(
      Effect.gen(function* readResultEffect(): Generator<unknown, StoredResult> {
        const index: number = yield* parseNonNegativeInteger(indexText, HTTP_PARAMETER.RESULT_INDEX);
        const jobs: JobServiceShape = yield* JobService;
        const metadata: JobResult = yield* jobs.getResult(id, index);
        const storage: ResultStorageShape = yield* ResultStorage;
        return yield* storage.read(metadata);
      }),
    );
    reply.header(HTTP_HEADER.CACHE_CONTROL, RESULT_CACHE_CONTROL);
    reply.header(HTTP_HEADER.CONTENT_LENGTH, String(stored.metadata.sizeBytes));
    reply.header(HTTP_HEADER.ETAG, `"${stored.metadata.sha256}"`);
    reply.type(stored.metadata.mimeType).send(stored.stream);
  }
}

export { ResultController };
