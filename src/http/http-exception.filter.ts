import {
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";

import { HTTP_HEADER } from "@app/http/http.constants.js";
import { PublicHttpException } from "@app/http/public-http.types.js";

/** Fastify exception filter adding Retry-After to bounded overload responses. */
@Catch(PublicHttpException)
class PublicHttpExceptionFilter implements ExceptionFilter<PublicHttpException> {
  /**
   * Serializes one safe public HTTP exception.
   *
   * @param exception - (PublicHttpException) Mapped application exception.
   * @param host - (ArgumentsHost) NestJS execution context.
   * @returns (void) Response is sent directly through Fastify.
   */
  catch(exception: PublicHttpException, host: ArgumentsHost): void {
    const reply: FastifyReply = host.switchToHttp().getResponse<FastifyReply>();
    const retryAfterSeconds: number | undefined =
      exception.getRetryAfterSeconds();
    if (retryAfterSeconds !== undefined) {
      reply.header(HTTP_HEADER.RETRY_AFTER, String(retryAfterSeconds));
    }
    reply.status(exception.getStatus()).send(exception.getResponse());
  }
}

export { PublicHttpExceptionFilter };
