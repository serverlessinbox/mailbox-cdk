import { Aws }                        from 'aws-cdk-lib';
import type { IConstruct }            from 'constructs';

import { PositionHash }               from './position-hash';
import { MAX_ROOT_STACK_NAME_LENGTH } from './root-stack-name-limit';
import { sanitizeStackName }          from './sanitize-name';
import { StackIdentity }              from './stack-identity';

/** Options for `makePhysicalName`. */
export interface PhysicalNameOptions {
  /** Hard cap for services with strict limits (e.g. Lambda 64, S3 63). */
  maxLength?: number;
}

/** Characters around the label: three hyphens, the 8-character position hash and the 8-character guid prefix. */
const SEPARATORS_AND_IDENTIFIERS_LENGTH = 19;

/**
 * A physical name of the form `<root stack name>-<slug(suffix)>-<position hash>-<guid prefix>`.
 *
 * The stack name is the deploy-time `Aws.STACK_NAME` token, so it is resolved at deployment and no synth-time
 * value enters the name. The position hash is `PositionHash.ofChild(scope, suffix)`: the name identifies the
 * resource created as `new X(scope, suffix)`, so it changes when `scope` moves to another parent. The guid
 * prefix (`StackIdentity.guidPrefix`) differs per install. `options.maxLength` is a hard bound: the name is
 * checked at the longest root stack name, and a label that cannot fit throws.
 */
export function makePhysicalName(scope: IConstruct, suffix: string, options: PhysicalNameOptions = {}): string {
  const suffixSlug = slugifyLabel(suffix);

  const maxLength = options.maxLength;
  if (typeof maxLength === 'number') {
    const longestName = suffixSlug.length + SEPARATORS_AND_IDENTIFIERS_LENGTH + MAX_ROOT_STACK_NAME_LENGTH;
    if (longestName > maxLength) {
      throw new Error(
        `Physical name for "${suffix}" is ${suffixSlug.length} label characters + ${SEPARATORS_AND_IDENTIFIERS_LENGTH} separator and identifier characters ` +
        `+ ${MAX_ROOT_STACK_NAME_LENGTH} root stack name characters = ${longestName} at most, above the limit of ${maxLength}. Use a shorter label.`,
      );
    }
  }

  return `${Aws.STACK_NAME}-${suffixSlug}-${PositionHash.ofChild(scope, suffix)}-${StackIdentity.guidPrefix}`;
}

/**
 * Turns a label like "Admin UI" into "admin-ui": lowercase, every character outside `a-z0-9-`
 * becomes a hyphen, hyphen runs collapse and leading and trailing hyphens are dropped.
 */
export function slugifyLabel(label: string): string {
  return sanitizeStackName(label);
}
