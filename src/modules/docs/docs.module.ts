import { DocsController } from "@app/modules/docs/docs.controller";
import { Module } from "@nestjs/common";

/** Unauthenticated OpenAPI document and reference page. */
@Module({ controllers: [DocsController] })
class DocsModule {}

export { DocsModule };
