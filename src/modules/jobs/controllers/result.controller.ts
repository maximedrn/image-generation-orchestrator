import {
  HttpCacheControl,
  HttpErrorMessage,
  HttpHeader,
  HttpHeaderSyntax,
  HttpParameter,
  HttpRoute,
} from "@app/core/http/http.constants";
import { HttpEffectService } from "@app/core/http/http-effect.service";
import { SchemaValidationPipe } from "@app/core/http/schema-validation.pipe";
import { BearerAuthGuard } from "@app/core/security/bearer-auth.guard";
import type {
  ResultStorageShape,
  StoredResult,
} from "@app/infrastructure/storage/storage.interface";
import { ResultStorage } from "@app/infrastructure/storage/storage.service";
import type { JobServiceShape } from "@app/modules/jobs/job.interface";
import { JobService } from "@app/modules/jobs/job.service";
import type { JobResult } from "@app/modules/jobs/job.types";
import { Controller, Get, Param, Res, UseGuards } from "@nestjs/common";
import { Effect, Schema } from "effect";
import type { FastifyReply } from "fastify";

/** Result index as it arrives on the URL, before decoding. */
const ResultIndexSchema: Schema.Schema<number, string> =
  Schema.NumberFromString.pipe(Schema.int(), Schema.nonNegative());

/** Protected binary result HTTP adapter. */
@Controller(HttpRoute.jobCollection)
@UseGuards(BearerAuthGuard)
class ResultController {
  readonly #httpEffect: HttpEffectService;

  /**
   * Creates the result HTTP adapter.
   *
   * @param {HttpEffectService} httpEffect - Typed Effect/HTTP bridge.
   */
  constructor(httpEffect: HttpEffectService) {
    this.#httpEffect = httpEffect;
  }

  /**
   * Streams one generated result from durable storage without buffering the whole file.
   *
   * @param {string} id - Job identifier.
   * @param {number} index - Result index decoded at the boundary.
   * @param {FastifyReply} reply - Fastify response adapter.
   * @returns {Promise<void>} Completes after Fastify owns the binary response.
   */
  @Get(HttpRoute.result)
  async getResult(
    @Param(HttpParameter.jobId) id: string,
    @Param(
      HttpParameter.resultIndex,
      new SchemaValidationPipe(
        ResultIndexSchema,
        `${HttpParameter.resultIndex} ${HttpErrorMessage.notAnInteger}`,
      ),
    )
    index: number,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const stored: StoredResult = await this.#httpEffect.run(
      Effect.gen(function* readResultEffect() {
        const jobs: JobServiceShape = yield* JobService;
        const metadata: JobResult = yield* jobs.getResult(id, index);
        const storage: ResultStorageShape = yield* ResultStorage;
        return yield* storage.read(metadata);
      }),
    );
    reply.header(HttpHeader.cacheControl, HttpCacheControl.result);
    reply.header(HttpHeader.contentLength, String(stored.metadata.sizeBytes));
    reply.header(
      HttpHeader.etag,
      `${HttpHeaderSyntax.etagQuote}${stored.metadata.sha256}${HttpHeaderSyntax.etagQuote}`,
    );
    reply.type(stored.metadata.mimeType).send(stored.stream);
  }
}

export { ResultController };
