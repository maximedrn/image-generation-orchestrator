import { MetricsController } from "@app/modules/metrics/metrics.controller";
import { Module } from "@nestjs/common";

/** Bounded operational metrics without prompt or secret data. */
@Module({ controllers: [MetricsController] })
class MetricsModule {}

export { MetricsModule };
