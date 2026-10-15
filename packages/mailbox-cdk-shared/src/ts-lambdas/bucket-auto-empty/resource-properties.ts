import * as t from 'typanion';

export const isBucketAutoEmptyResourceProperties = t.isPartial({
  bucketName: t.isOptional(t.isString()),
});

/**
 * The properties of a `Custom::BucketAutoEmpty` resource: the bucket to empty when the resource is
 * deleted. `ServiceToken`, which CloudFormation adds to every request, is deliberately not listed.
 */
export type BucketAutoEmptyResourceProperties = t.InferType<typeof isBucketAutoEmptyResourceProperties>;

export const isBucketAutoEmptyDeletionProperties = t.isPartial({
  bucketName: t.isString(),
});

/** The only property a Delete needs: the bucket to empty. Any other property is ignored on a Delete. */
export type BucketAutoEmptyDeletionProperties = t.InferType<typeof isBucketAutoEmptyDeletionProperties>;
