export const SUPPORTED_ALGORITHMS = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384'] as const;

/** A JWT signature algorithm the verifier accepts. */
export type SupportedAlgorithm = (typeof SUPPORTED_ALGORITHMS)[number];

/**
 * The custom origin headers the CDN sets on the S3 origin and this function reads, with the value each carries.
 * The CDN construct builds its headers against this type, so a header added, removed or renamed here breaks
 * its compile. `x-jwt-algorithms` is typed as the single algorithm the CDN sends.
 */
export type BlobDownloadOriginHeaders = {
  'x-auth-key-store-table': string;
  'x-region':               string;
  'x-jwt-algorithms':       SupportedAlgorithm;
};
