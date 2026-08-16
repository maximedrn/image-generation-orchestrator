import { EngineController } from "@app/modules/engines/engine.controller";
import { Module } from "@nestjs/common";

/** Read-only inference-engine registry exposed to operators. */
@Module({ controllers: [EngineController] })
class EnginesModule {}

export { EnginesModule };
