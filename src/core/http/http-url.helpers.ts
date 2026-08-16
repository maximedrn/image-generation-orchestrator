import {
  HttpPathSeparator,
  HttpRoute,
  HttpSegment,
} from "@app/core/http/http.constants";

/**
 * Builds the public path identifying one generated result.
 *
 * Assembled from the same segments the controllers register their routes with,
 * so a renamed segment can never produce a link the server does not serve.
 *
 * @param {string} jobId - Durable job identifier.
 * @param {number} index - Result index inside the generated batch.
 * @returns {string} Path relative to the job collection.
 */
const resultPath = (jobId: string, index: number): string =>
  `${jobId}${HttpPathSeparator}${HttpSegment.results}${HttpPathSeparator}${index}`;

/**
 * Builds the absolute public URL of one generated result.
 *
 * @param {string} jobId - Durable job identifier.
 * @param {number} index - Result index inside the generated batch.
 * @returns {string} Absolute URL exposed by the public job representation.
 */
const resultUrl = (jobId: string, index: number): string =>
  `${HttpPathSeparator}${HttpRoute.jobCollection}${HttpPathSeparator}${resultPath(jobId, index)}`;

export { resultPath, resultUrl };
