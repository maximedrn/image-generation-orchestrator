/**
 * Identifiers of every `Effect.Service` in the platform.
 *
 * Collected here so the whole service registry is visible in one place and two
 * services cannot silently claim the same identity.
 */
const ServiceTag = {
  configService: "platform/core/ConfigService",
  databaseService: "platform/infrastructure/DatabaseService",
  dispatcher: "platform/infrastructure/Dispatcher",
  engineGateway: "platform/infrastructure/EngineGateway",
  enginePool: "platform/infrastructure/EnginePool",
  jobRepository: "platform/infrastructure/JobRepository",
  jobService: "platform/modules/JobService",
  modelDownloader: "platform/infrastructure/ModelDownloader",
  rateLimiter: "platform/core/RateLimiter",
  resultStorage: "platform/infrastructure/ResultStorage",
  securityService: "platform/core/SecurityService",
} as const;

export { ServiceTag };
