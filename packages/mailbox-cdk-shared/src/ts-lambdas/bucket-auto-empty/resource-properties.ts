import * as t from 'typanion';

export const isBucketAutoEmptyResourceProperties = t.isPartial({
  bucketName: t.isOptional(t.isString()),
});

/**
 * The properties of a `Custom::BucketAutoEmpty` resource: the bucket to empty when the resource is
 * deleted. `ServiceToken`, which CloudFormation adds to every request, is deliberately not listed.
 */
export type BucketAutoEmptyResourceProperties = t.InferType<typeof isBucketAutoEmptyResourceProperties>;
