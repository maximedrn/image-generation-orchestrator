import type { UnauthorizedError } from "@app/core/errors/error.types";
import { HttpEffectService } from "@app/core/http/http-effect.service";
import { SecurityService } from "@app/core/security/security.service";
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { Effect } from "effect";
import type { FastifyRequest } from "fastify";

/** NestJS guard delegating bearer verification to the Effect security service. */
@Injectable()
class BearerAuthGuard implements CanActivate {
  readonly #httpEffect: HttpEffectService;

  /**
   * Creates the bearer authentication guard.
   *
   * @param {HttpEffectService} httpEffect - Typed HTTP Effect executor.
   */
  constructor(httpEffect: HttpEffectService) {
    this.#httpEffect = httpEffect;
  }

  /**
   * Authorizes one HTTP request.
   *
   * @param {ExecutionContext} context - NestJS request context.
   * @returns {Promise<boolean>} `true` after successful authorization.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: FastifyRequest = context.switchToHttp().getRequest();
    await this.#httpEffect.run(
      Effect.flatMap(
        SecurityService,
        (security: SecurityService): Effect.Effect<void, UnauthorizedError> =>
          security.authorize(request.headers.authorization),
      ),
    );
    return true;
  }
}

export { BearerAuthGuard };
