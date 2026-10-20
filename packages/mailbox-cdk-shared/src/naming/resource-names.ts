import { Stack }             from 'aws-cdk-lib';
import type { IConstruct }   from 'constructs';
import { createHash }        from 'node:crypto';

import { PositionHash }      from './position-hash';
import { sanitizeStackName } from './sanitize-name';
import { StackIdentity }     from './stack-identity';

/** Options for `makePhysicalName`. */
export interface PhysicalNameOptions {
  /** Hard cap for services with strict limits (e.g. Lambda 64, S3 63). */
  maxLength?: number;
}

/** Characters appended after the readable part: `-`, the 8-character position hash, `-`, the 8-character guid prefix. */
const IDENTITY_TAIL_LENGTH = 18;

/**
 * A physical name of the form `<account>-<sanitize(stackName)>-<slug(suffix)>-<position hash>-<guid prefix>`.
 *
 * The position hash is `PositionHash.ofChild(scope, suffix)`: the name identifies the resource
 * created as `new X(scope, suffix)`, so it changes when `scope` moves to another parent. The guid
 * prefix (`StackIdentity.guidPrefix`) makes it differ per install. Both are always whole; when
 * `options.maxLength` is given, only the readable part is shortened (with a hash tail) to
 * `maxLength` minus the 18 characters the two identifiers and their hyphens take.
 */
export function makePhysicalName(scope: IConstruct, suffix: string, options: PhysicalNameOptions = {}): string {
  const stack      = Stack.of(scope);
  const account    = stack.account;
  const stackSlug  = sanitizeStackName(stack.stackName);
  const suffixSlug = slugifyLabel(suffix);

  const base      = `${account}-${stackSlug}-${suffixSlug}`;
  const maxLength = options.maxLength;
  const readable  = typeof maxLength === 'number' ? withMaxLength(base, maxLength - IDENTITY_TAIL_LENGTH) : base;
  return `${readable}-${PositionHash.ofChild(scope, suffix)}-${StackIdentity.guidPrefix}`;
}

/**
 * Turns a label like "Admin UI" into "admin-ui": lowercase, every character outside `a-z0-9-`
 * becomes a hyphen, hyphen runs collapse and leading and trailing hyphens are dropped.
 */
export function slugifyLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Replaces the tail of an over-long name with a hash of the full name, so different long names stay different. */
function withMaxLength(name: string, maxLength: number): string {
  if (name.length <= maxLength) {
    return name;
  }

  const hash   = createHash('sha1').update(name).digest('hex').slice(0, 8);
  const suffix = `-${hash}`;
  const keep   = Math.max(1, maxLength - suffix.length);
  return `${name.slice(0, keep)}${suffix}`.replace(/-+$/g, '');
}
