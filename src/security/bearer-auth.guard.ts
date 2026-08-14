import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { Effect } from "effect";
import type { FastifyRequest } from "fastify";

import type { UnauthorizedError } from "@app/error/error.types.js";
import { HttpEffectService } from "@app/http/http-effect.service.js";
import type { SecurityServiceShape } from "@app/security/security.interface.js";
import { SecurityService } from "@app/security/security.service.js";

/** NestJS guard delegating bearer verification to the Effect security service. */
@Injectable()
class BearerAuthGuard implements CanActivate {
  readonly #httpEffect: HttpEffectService;

  /**
   * Creates the bearer authentication guard.
   *
   * @param httpEffect - (HttpEffectService) Typed HTTP Effect executor.
   */
  constructor(httpEffect: HttpEffectService) {
    this.#httpEffect = httpEffect;
  }

  /**
   * Authorizes one HTTP request.
   *
   * @param context - (ExecutionContext) NestJS request context.
   * @returns (Promise<boolean>) `true` after successful authorization.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: FastifyRequest = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers.authorization;
    await this.#httpEffect.run(
      Effect.flatMap(
        SecurityService,
        (security: SecurityServiceShape): Effect.Effect<void, UnauthorizedError> => security.authorize(header),
      ),
    );
    return true;
  }
}

export { BearerAuthGuard };
