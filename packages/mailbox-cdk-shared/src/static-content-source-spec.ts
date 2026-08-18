import * as t from 'typanion';

/** The ONLY shape that ever crosses the CustomResource property boundary — plain, CFN-serializable
 *  JSON, kind-discriminated. Verified this composes cleanly through CFN's custom-resource properties
 *  (already proven by this exact codebase's existing `invalidationPaths: string[]` array-valued
 *  property; a `kind`-tagged object array is the same shape, one more discriminant field).
 *
 *  This type is derived from `staticContentSourceSpecSchema` (the canonical runtime validator).
 *  Use the schema as the single source of truth; the type is derived via `t.InferType<>`. */

/**
 * Typanion schema for a 'data' kind StaticContentSourceSpec.
 * Validates that required fields (kind, key, body) are strings, and optional fields
 * (contentType, cacheControl) are strings if present.
 */
export const dataSourceSchema = t.isObject(
  {
    kind: t.isLiteral('data'),
    key: t.isString(),
    body: t.isString(),
    contentType: t.isOptional(t.isString()),
    cacheControl: t.isOptional(t.isString()),
  },
  { extra: t.isRecord(t.isUnknown()) },
);

/**
 * Typanion schema for a 'zip' kind StaticContentSourceSpec.
 * Validates that required fields (kind, sourceBucket, sourceKey, targetPrefix) are strings,
 * and optional field (sourceVersionId) is a string if present.
 */
export const zipSourceSchema = t.isObject(
  {
    kind: t.isLiteral('zip'),
    sourceBucket: t.isString(),
    sourceKey: t.isString(),
    targetPrefix: t.isString(),
    sourceVersionId: t.isOptional(t.isString()),
  },
  { extra: t.isRecord(t.isUnknown()) },
);

/**
 * Typanion schema for a single StaticContentSourceSpec entry.
 * Accepts either a 'data' or 'zip' kind, validated by their respective schemas.
 */
export const staticContentSourceSpecSchema = t.isOneOf([
  dataSourceSchema,
  zipSourceSchema,
]);

/** Derive the type from the schema — the schema is the single source of truth. */
export type StaticContentSourceSpec = t.InferType<typeof staticContentSourceSpecSchema>;
