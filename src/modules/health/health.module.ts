import { HealthController } from "@app/modules/health/health.controller";
import { Module } from "@nestjs/common";

/** Unauthenticated liveness and readiness probes. */
@Module({ controllers: [HealthController] })
class HealthModule {}

export { HealthModule };
