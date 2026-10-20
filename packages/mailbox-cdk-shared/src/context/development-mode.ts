import { RemovalPolicy }           from 'aws-cdk-lib';
import { Construct }               from 'constructs';

import { DEVELOPMENT_CONTEXT_KEY } from './context-keys';

const TRUTHY_VALUES = new Set(['true', '1', 'yes', 'y', 'dev']);
const FALSY_VALUES  = new Set(['false', '0', 'no', 'n']);

function parseTruthy(key: string, value: unknown): boolean {
  if (typeof value === 'boolean') {return value;}

  const normalized = String(value).trim().toLowerCase();
  if (TRUTHY_VALUES.has(normalized)) {return true;}
  if (FALSY_VALUES.has(normalized)) {return false;}

  throw new Error(
    `@serverlessinbox/mailbox: invalid CDK context value for "${key}": ${JSON.stringify(value)}. ` +
    'Must be a boolean-like value (true/false/1/0/yes/no/y/n/dev).'
  );
}

/**
 * Returns true when CDK context enables development mode (`serverlessinbox:development=true`).
 * Absent context is a normal, supported state (falls back to false) — this key is present but
 * malformed (not absent) that throws.
 */
export function isDevelopmentMode(scope: Construct): boolean {
  const value = scope.node.tryGetContext(DEVELOPMENT_CONTEXT_KEY);
  if (value === undefined || value === null) {return false;}
  return parseTruthy(DEVELOPMENT_CONTEXT_KEY, value);
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
