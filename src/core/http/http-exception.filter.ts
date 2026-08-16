import { HttpErrorMessage, HttpHeader } from "@app/core/http/http.constants";
import { unmappedPlatformError } from "@app/core/http/http-error.helpers";
import { PublicHttpException } from "@app/core/http/public-http.types";
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import { Option } from "effect";
import type { FastifyReply } from "fastify";

/**
 * Transport exception boundary: every failure leaves through this filter.
 *
 * It catches everything on purpose. `logger: false` in `main.ts` silences the
 * NestJS `ExceptionsHandler`, so without this filter an unmapped defect reaches
 * the client as an opaque 500 and is never written to any log.
 */
@Catch()
class PublicHttpExceptionFilter implements ExceptionFilter<unknown> {
  /**
   * Serializes one mapped public exception, adding Retry-After when bounded.
   *
   * @param {PublicHttpException} exception - Mapped application exception.
   * @param {FastifyReply} reply - Fastify response adapter.
   * @returns {void} Response is sent directly through Fastify.
   */
  #sendPublic(exception: PublicHttpException, reply: FastifyReply): void {
    Option.match(Option.fromNullable(exception.getRetryAfterSeconds()), {
      onNone: (): void => undefined,
      onSome: (seconds: number): void => {
        reply.header(HttpHeader.retryAfter, String(seconds));
      },
    });
    reply.status(exception.getStatus()).send(exception.getResponse());
  }

  /**
   * Routes one failure to the public contract, logging only true defects.
   *
   * @param {unknown} exception - Any value thrown inside the request pipeline.
   * @param {ArgumentsHost} host - NestJS execution context.
   * @returns {void} Response is sent directly through Fastify.
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply: FastifyReply = host.switchToHttp().getResponse<FastifyReply>();
    if (exception instanceof PublicHttpException) {
      this.#sendPublic(exception, reply);
      return;
    }
    if (exception instanceof HttpException) {
      reply.status(exception.getStatus()).send(exception.getResponse());
      return;
    }
    // The only place an unmapped defect is ever recorded: keep the cause in the
    // request-scoped log, and keep it out of the response body.
    reply.log.error({ err: exception }, HttpErrorMessage.internal);
    this.#sendPublic(unmappedPlatformError(), reply);
  }
}

export { PublicHttpExceptionFilter };
