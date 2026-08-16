import { RuntimeToken } from "@app/core/runtime/runtime.constants";
import type { AppContext, AppRuntime } from "@app/core/runtime/runtime.types";
import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { Effect, type Either } from "effect";

/** NestJS adapter around the one process-wide Effect ManagedRuntime. */
@Injectable()
class EffectRuntimeService implements OnApplicationShutdown {
  readonly #runtime: AppRuntime;

  /**
   * Creates the NestJS runtime bridge.
   *
   * @param {AppRuntime} runtime - Process-wide Effect runtime.
   */
  constructor(@Inject(RuntimeToken.effectRuntime) runtime: AppRuntime) {
    this.#runtime = runtime;
  }

  /**
   * Executes an Effect whose service requirements are provided by AppContext.
   *
   * @param {Effect.Effect<A, E, R>} effect - Typed application effect.
   * @returns {Promise<A>} Promise resolved by the managed Effect runtime.
   */
  run<A, E, R extends AppContext>(effect: Effect.Effect<A, E, R>): Promise<A> {
    return this.#runtime.runPromise(effect);
  }

  /**
   * Executes an application Effect while preserving its typed error as a value.
   *
   * @param {Effect.Effect<A, E, R>} effect - Typed application effect.
   * @returns {Promise<Either.Either<A, E>>} Effect Either result.
   */
  runEither<A, E, R extends AppContext>(
    effect: Effect.Effect<A, E, R>,
  ): Promise<Either.Either<A, E>> {
    return this.#runtime.runPromise(Effect.either(effect));
  }

  /**
   * Disposes scoped services and interrupts scoped fibers on application shutdown.
   *
   * @returns {Promise<void>} Runtime disposal completion.
   */
  onApplicationShutdown(): Promise<void> {
    return this.#runtime.dispose();
  }
}

export { EffectRuntimeService };
