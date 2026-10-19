import { Stack } from 'aws-cdk-lib';
import type { IConstruct } from 'constructs';
import { createHash } from 'node:crypto';
import { sanitizeStackName } from './sanitize-name';

/** Options for `makePhysicalName`. */
export interface PhysicalNameOptions {
  /** Hard cap for services with strict limits (e.g. Lambda 64, S3 63). */
  maxLength?: number;
}

/**
 * A stable, customer-friendly physical name of the form
 * `<account>-<sanitize(stackName)>-<slug(suffix)>`, shortened with a hash tail when it exceeds
 * `options.maxLength`.
 */
export function makePhysicalName(scope: IConstruct, suffix: string, options: PhysicalNameOptions = {}): string {
  const stack = Stack.of(scope);
  const account = stack.account;
  const stackSlug = sanitizeStackName(stack.stackName);
  const suffixSlug = slugifyLabel(suffix);

  const base = `${account}-${stackSlug}-${suffixSlug}`;
  const maxLength = options.maxLength;
  return typeof maxLength === 'number' ? withMaxLength(base, maxLength) : base;
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

  const hash = createHash('sha1').update(name).digest('hex').slice(0, 8);
  const suffix = `-${hash}`;
  const keep = Math.max(1, maxLength - suffix.length);
  return `${name.slice(0, keep)}${suffix}`.replace(/-+$/g, '');
}
