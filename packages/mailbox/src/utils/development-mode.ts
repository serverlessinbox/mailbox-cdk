import { RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export const DEVELOPMENT_CONTEXT_KEYS = ['development', 'mailbox:development'] as const;

function parseTruthy(value: unknown): boolean {
  if (value === true) return true;
  if (value === false || value == null) return false;

  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'y' || normalized === 'dev';
}

/**
 * Returns true when CDK context enables development mode.
 *
 * Supported context keys:
 * - `development=true`
 * - `mailbox:development=true`
 */
export function isDevelopmentMode(scope: Construct): boolean {
  for (const key of DEVELOPMENT_CONTEXT_KEYS) {
    const value = scope.node.tryGetContext(key);
    if (value !== undefined) {
      return parseTruthy(value);
    }
  }

  return false;
}

/**
 * Removal policy to use for resources that are normally retained.
 * In development mode, this flips to DESTROY to make `cdk destroy` clean.
 */
export function removalPolicyForRetainedResources(scope: Construct): RemovalPolicy {
  return isDevelopmentMode(scope) ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE;
}

/**
 * Whether S3 buckets should automatically delete objects.
 * Intended to be enabled in development mode only.
 */
export function autoDeleteObjectsInDevelopment(scope: Construct): boolean {
  return isDevelopmentMode(scope);
}
