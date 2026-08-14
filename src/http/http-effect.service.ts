import { Injectable } from "@nestjs/common";
import { Either, type Effect } from "effect";

import type { PlatformError } from "@app/error/error.types.js";
import { mapPlatformErrorToHttp } from "@app/http/http-error.helpers.js";
import type { AppContext } from "@app/runtime/runtime.types.js";
import { EffectRuntimeService } from "@app/runtime/runtime.service.js";

/** NestJS transport adapter converting typed Effect failures to HTTP exceptions. */
@Injectable()
class HttpEffectService {
  readonly #runtime: EffectRuntimeService;

  /**
   * Creates the HTTP Effect executor.
   *
   * @param runtime - (EffectRuntimeService) Application runtime bridge.
   */
  constructor(runtime: EffectRuntimeService) {
    this.#runtime = runtime;
  }

  /**
   * Runs an application Effect and maps its typed error channel to HTTP.
   *
   * @param effect - (Effect.Effect<A, E, R>) Application effect.
   * @returns (Promise<A>) Successful result or rejected PublicHttpException.
   */
  async run<A, E extends PlatformError, R extends AppContext>(
    effect: Effect.Effect<A, E, R>,
  ): Promise<A> {
    const result: Either.Either<A, E> = await this.#runtime.runEither(effect);
    if (Either.isLeft(result)) {
      throw mapPlatformErrorToHttp(result.left);
    }
    return result.right;
  }
}

export { HttpEffectService };
