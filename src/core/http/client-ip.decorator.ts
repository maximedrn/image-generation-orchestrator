import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

/**
 * Reads the caller address without leaking the Fastify request into handlers.
 *
 * @param {unknown} _data - Unused decorator argument required by the Nest API.
 * @param {ExecutionContext} context - NestJS request context.
 * @returns {string} Remote address used as the rate-limit key.
 */
const ClientIp = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string =>
    context.switchToHttp().getRequest<FastifyRequest>().ip,
);

export { ClientIp };
