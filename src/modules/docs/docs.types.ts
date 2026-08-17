import type { JSONSchema } from "effect";

/** Reference to a schema published under the components section. */
interface OpenApiReference {
  readonly $ref: string;
}

/** Either an inline schema or a reference to a published one. */
type OpenApiSchema = JSONSchema.JsonSchema7 | OpenApiReference;

/** Body of a request or a response, keyed by media type. */
interface OpenApiContent {
  readonly [mediaType: string]: { readonly schema: OpenApiSchema };
}

/** One documented response of an operation. */
interface OpenApiResponse {
  readonly content?: OpenApiContent;
  readonly description: string;
}

/** One documented request body. */
interface OpenApiRequestBody {
  readonly content: OpenApiContent;
  readonly required: boolean;
}

/** One documented path parameter. */
interface OpenApiParameter {
  readonly description: string;
  readonly in: "path";
  readonly name: string;
  readonly required: boolean;
  readonly schema: OpenApiSchema;
}

/** Security requirement naming a scheme and its scopes. */
interface OpenApiSecurityRequirement {
  readonly [scheme: string]: readonly string[];
}

/** One documented operation on a path. */
interface OpenApiOperation {
  readonly description: string;
  readonly operationId: string;
  readonly parameters?: readonly OpenApiParameter[];
  readonly requestBody?: OpenApiRequestBody;
  readonly responses: { readonly [status: string]: OpenApiResponse };
  readonly security?: readonly OpenApiSecurityRequirement[];
  readonly summary: string;
  readonly tags: readonly string[];
}

/** Operations available on one path, keyed by HTTP method. */
interface OpenApiPathItem {
  readonly delete?: OpenApiOperation;
  readonly get?: OpenApiOperation;
  readonly post?: OpenApiOperation;
}

/** Authentication scheme published once and referenced by operations. */
interface OpenApiSecurityScheme {
  readonly bearerFormat: string;
  readonly description: string;
  readonly scheme: string;
  readonly type: string;
}

/** Reusable schemas and security schemes. */
interface OpenApiComponents {
  readonly schemas: { readonly [name: string]: OpenApiSchema };
  readonly securitySchemes: {
    readonly [name: string]: OpenApiSecurityScheme;
  };
}

/** Document metadata. */
interface OpenApiInfo {
  readonly description: string;
  readonly title: string;
  readonly version: string;
}

/** Group an operation can be listed under. */
interface OpenApiTag {
  readonly description: string;
  readonly name: string;
}

/** Complete OpenAPI document served to clients and viewers. */
interface OpenApiDocument {
  readonly components: OpenApiComponents;
  readonly info: OpenApiInfo;
  readonly openapi: string;
  readonly paths: { readonly [path: string]: OpenApiPathItem };
  readonly security: readonly OpenApiSecurityRequirement[];
  readonly tags: readonly OpenApiTag[];
}

export type {
  OpenApiComponents,
  OpenApiContent,
  OpenApiDocument,
  OpenApiInfo,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiPathItem,
  OpenApiReference,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiSchema,
  OpenApiSecurityRequirement,
  OpenApiSecurityScheme,
  OpenApiTag,
};
