import * as t from 'typanion';
import type { StaticContentSourceSpec } from '../../static-content-source-spec';
import {
  staticContentSourceSpecSchema,
} from '../../static-content-source-spec';

export type { StaticContentSourceSpec } from '../../static-content-source-spec';

/**
 * CloudFormation's CustomResource property serialization can coerce booleans to strings.
 * The interface reflects what we accept at the runtime validator boundary,
 * accounting for CloudFormation's documented type coercion behavior.
 */
export interface ContentDeployerResourceProperties {
  readonly targetBucket?: string;
  readonly deploymentNonce?: string;
  /** Discriminated union of deployment sources (data writes or zip unpacks). */
  readonly sources?: StaticContentSourceSpec[];
  // Optional CDN invalidation
  readonly distributionId?: string;
  readonly invalidationPaths?: string[];
}

/**
 * Typanion schema for ContentDeployerResourceProperties.
 * Validates the overall resource properties shape including optional bucket, sources array,
 * and CloudFront invalidation fields.
 */
const contentDeployerPropsSchema = t.isObject(
  {
    targetBucket: t.isOptional(t.isString()),
    deploymentNonce: t.isOptional(t.isString()),
    sources: t.isOptional(t.isArray(staticContentSourceSpecSchema)),
    distributionId: t.isOptional(t.isString()),
    invalidationPaths: t.isOptional(t.isArray(t.isString())),
  },
  { extra: t.isRecord(t.isUnknown()) },
);

export function isContentDeployerResourceProperties(obj: unknown): obj is ContentDeployerResourceProperties {
  return contentDeployerPropsSchema(obj);
}
