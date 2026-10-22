import * as t from 'typanion';

const isDataSourceSpec = t.isPartial({
  kind: t.isLiteral('data'),
  key: t.isString(),
  body: t.isString(),
  contentType: t.isOptional(t.isString()),
  cacheControl: t.isOptional(t.isString()),
});

/** A source that writes one object, with the given body, at an exact key. */
export type DataSourceSpec = t.InferType<typeof isDataSourceSpec>;

const isZipSourceSpec = t.isPartial({
  kind: t.isLiteral('zip'),
  sourceBucket: t.isString(),
  sourceKey: t.isString(),
  targetPrefix: t.isString(),
  sourceVersionId: t.isOptional(t.isString()),
});

/** A source that unpacks a zip archive under a key prefix of the target bucket. */
export type ZipSourceSpec = t.InferType<typeof isZipSourceSpec>;

const isStaticContentSourceSpec = t.isOneOf([isDataSourceSpec, isZipSourceSpec]);

/** One source of a `Custom::ContentDeployment` resource, tagged by `kind`. */
export type StaticContentSourceSpec = t.InferType<typeof isStaticContentSourceSpec>;

export const isContentDeployerResourceProperties = t.isPartial({
  targetBucket: t.isOptional(t.isString()),
  deploymentNonce: t.isOptional(t.isString()),
  sources: t.isOptional(t.isArray(isStaticContentSourceSpec)),
  distributionId: t.isOptional(t.isString()),
  invalidationPaths: t.isOptional(t.isArray(t.isString())),
});

/**
 * The properties of a `Custom::ContentDeployment` or `Custom::ContentInvalidation` resource: the sources to
 * deploy into `targetBucket`, then the CloudFront paths to invalidate. `ServiceToken`, which
 * CloudFormation adds to every request, is deliberately not listed.
 */
export type ContentDeployerResourceProperties = t.InferType<typeof isContentDeployerResourceProperties>;
