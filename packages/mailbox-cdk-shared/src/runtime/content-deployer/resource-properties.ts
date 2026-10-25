import * as t from 'typanion';

const isDataSourceSpec = t.isPartial({
  kind:         t.isLiteral('data'),
  key:          t.isString(),
  body:         t.isString(),
  contentType:  t.isOptional(t.isString()),
  cacheControl: t.isOptional(t.isString()),
});

const isZipSourceSpec = t.isPartial({
  kind:            t.isLiteral('zip'),
  sourceBucket:    t.isString(),
  sourceKey:       t.isString(),
  targetPrefix:    t.isString(),
  sourceVersionId: t.isOptional(t.isString()),
});

const isStaticContentSourceSpec = t.isOneOf([isDataSourceSpec, isZipSourceSpec]);

/** Validates the properties of a `Custom::ContentDeployment` or `Custom::ContentInvalidation` resource; its type is `ContentDeployerResourceProperties`. */
export const isContentDeployerResourceProperties = t.isPartial({
  targetBucket:      t.isOptional(t.isString()),
  deploymentNonce:   t.isOptional(t.isString()),
  sources:           t.isOptional(t.isArray(isStaticContentSourceSpec)),
  distributionId:    t.isOptional(t.isString()),
  invalidationPaths: t.isOptional(t.isArray(t.isString())),
});
