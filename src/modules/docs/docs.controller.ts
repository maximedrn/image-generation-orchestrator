import { HttpHeader, HttpRoute } from "@app/core/http/http.constants";
import { DocsMediaType, DocsUi } from "@app/modules/docs/docs.constants";
import { OpenApiDocumentation } from "@app/modules/docs/docs.document";
import type { OpenApiDocument } from "@app/modules/docs/docs.types";
import { Controller, Get, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";

/**
 * Renders the reference page pointing at the served document.
 *
 * @returns {string} Self-contained HTML page.
 */
const renderDocsPage = (): string =>
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${DocsUi.title}</title>
    <link
      rel="stylesheet"
      href="${DocsUi.stylesheetUrl}"
      integrity="${DocsUi.stylesheetIntegrity}"
      crossorigin="anonymous"
    />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script
      src="${DocsUi.bundleUrl}"
      integrity="${DocsUi.bundleIntegrity}"
      crossorigin="anonymous"
    ></script>
    <script>
      window.SwaggerUIBundle({
        dom_id: "#swagger-ui",
        url: "/${HttpRoute.openapi}",
      });
    </script>
  </body>
</html>
`;

/** Page served for every request, built once at module load. */
const DocsPage: string = renderDocsPage();

/**
 * Unauthenticated API reference.
 *
 * The document describes the contract rather than exposing anything behind it,
 * and a specification a client cannot fetch without already holding a key is
 * of no use to the tooling that consumes it.
 */
@Controller()
class DocsController {
  /**
   * Returns the OpenAPI document describing every public route.
   *
   * @returns {OpenApiDocument} Served specification.
   */
  @Get(HttpRoute.openapi)
  document(): OpenApiDocument {
    return OpenApiDocumentation;
  }

  /**
   * Serves the reference page rendering the document.
   *
   * @param {FastifyReply} reply - Fastify response adapter.
   * @returns {void} Completes once Fastify owns the response.
   */
  @Get(HttpRoute.docs)
  page(@Res() reply: FastifyReply): void {
    reply.header(HttpHeader.contentLength, String(Buffer.byteLength(DocsPage)));
    reply.type(DocsMediaType.html).send(DocsPage);
  }
}

export { DocsController, DocsPage, renderDocsPage };
