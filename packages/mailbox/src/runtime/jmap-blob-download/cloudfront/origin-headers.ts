import * as t from 'typanion';

/** The JWT signature algorithms a distribution may configure; the function verifies no other. */
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
  /** The origins allowed to download cross-origin, comma-separated; absent when no origin is allowed. */
  'x-allowed-origins'?:     string;
};

/** Narrows a value to one of the `SUPPORTED_ALGORITHMS`. */
export const isSupportedAlgorithm = t.isEnum(SUPPORTED_ALGORITHMS);
