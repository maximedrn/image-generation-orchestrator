import type { PlatformError } from "@app/core/errors/error.types";
import { mapPlatformErrorToHttp } from "@app/core/http/http-error.helpers";
import { EffectRuntimeService } from "@app/core/runtime/runtime.service";
import type { AppContext } from "@app/core/runtime/runtime.types";
import { Injectable } from "@nestjs/common";
import { type Effect, Either } from "effect";

/** NestJS transport adapter converting typed Effect failures to HTTP exceptions. */
@Injectable()
class HttpEffectService {
  readonly #runtime: EffectRuntimeService;

  /**
   * Creates the HTTP Effect executor.
   *
   * @param {EffectRuntimeService} runtime - Application runtime bridge.
   */
  constructor(runtime: EffectRuntimeService) {
    this.#runtime = runtime;
  }

  /**
   * Runs an application Effect and maps its typed error channel to HTTP.
   *
   * @param {Effect.Effect<A, E, R>} effect - Application effect.
   * @returns {Promise<A>} Successful result or rejected PublicHttpException.
   */
  async run<A, E extends PlatformError, R extends AppContext>(
    effect: Effect.Effect<A, E, R>,
  ): Promise<A> {
    const result: Either.Either<A, E> = await this.#runtime.runEither(effect);
    if (Either.isLeft(result)) throw mapPlatformErrorToHttp(result.left);
    return result.right;
  }
}

export { HttpEffectService };
