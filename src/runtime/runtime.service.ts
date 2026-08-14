import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { Effect, type Either } from "effect";

import { EFFECT_RUNTIME_TOKEN } from "@app/runtime/runtime.constants.js";
import type { AppContext, AppRuntime } from "@app/runtime/runtime.types.js";

/** NestJS adapter around the one process-wide Effect ManagedRuntime. */
@Injectable()
class EffectRuntimeService implements OnApplicationShutdown {
  readonly #runtime: AppRuntime;

  /**
   * Creates the NestJS runtime bridge.
   *
   * @param runtime - (AppRuntime) Process-wide Effect runtime.
   */
  constructor(@Inject(EFFECT_RUNTIME_TOKEN) runtime: AppRuntime) {
    this.#runtime = runtime;
  }

  /**
   * Executes an Effect whose service requirements are provided by AppContext.
   *
   * @param effect - (Effect.Effect<A, E, R>) Typed application effect.
   * @returns (Promise<A>) Promise resolved by the managed Effect runtime.
   */
  run<A, E, R extends AppContext>(effect: Effect.Effect<A, E, R>): Promise<A> {
    return this.#runtime.runPromise(effect);
  }

  /**
   * Executes an application Effect while preserving its typed error as a value.
   *
   * @param effect - (Effect.Effect<A, E, R>) Typed application effect.
   * @returns (Promise<Either.Either<A, E>>) Effect Either result.
   */
  runEither<A, E, R extends AppContext>(
    effect: Effect.Effect<A, E, R>,
  ): Promise<Either.Either<A, E>> {
    return this.#runtime.runPromise(Effect.either(effect));
  }

  /**
   * Disposes scoped services and interrupts scoped fibers on application shutdown.
   *
   * @param signal - (string | undefined) Optional NestJS shutdown signal.
   * @returns (Promise<void>) Runtime disposal completion.
   */
  onApplicationShutdown(signal?: string): Promise<void> {
    void signal;
    return this.#runtime.dispose();
  }
}

export { EffectRuntimeService };
