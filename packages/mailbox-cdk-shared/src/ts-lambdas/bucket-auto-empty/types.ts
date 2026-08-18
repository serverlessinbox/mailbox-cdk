import * as t from 'typanion';

/**
 * CloudFormation CustomResource properties for BucketAutoEmpty.
 * bucketName is a CFN token backed by Ref, creating an implicit dependency.
 */
export interface BucketAutoEmptyResourceProperties {
  readonly bucketName?: string;
}

/**
 * Typanion schema for BucketAutoEmptyResourceProperties.
 * Validates the bucket name is a string when present (optional).
 */
const bucketAutoEmptyPropsSchema = t.isObject(
  {
    bucketName: t.isOptional(t.isString()),
  },
  { extra: t.isRecord(t.isUnknown()) },
);

export function isBucketAutoEmptyResourceProperties(obj: unknown): obj is BucketAutoEmptyResourceProperties {
  return bucketAutoEmptyPropsSchema(obj);
}
