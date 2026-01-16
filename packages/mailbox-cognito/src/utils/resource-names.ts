import { Stack } from 'aws-cdk-lib';
import type { IConstruct } from 'constructs';
import { createHash } from 'node:crypto';
import { sanitizeStackName } from './sanitize-name';

function slugifyPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function withMaxLength(name: string, maxLength: number): string {
  if (name.length <= maxLength) return name;

  const hash = createHash('sha1').update(name).digest('hex').slice(0, 8);
  const suffix = `-${hash}`;
  const keep = Math.max(1, maxLength - suffix.length);
  return `${name.slice(0, keep)}${suffix}`.replace(/-+$/g, '');
}

export interface PhysicalNameOptions {
  maxLength?: number;
}

/**
 * Create a stable physical name following the existing scheme:
 * `<account>-<sanitize(stackName)>-<suffix>`.
 */
export function makePhysicalName(scope: IConstruct, suffix: string, options: PhysicalNameOptions = {}): string {
  const stack = Stack.of(scope);
  const account = stack.account;
  const stackSlug = sanitizeStackName(stack.stackName);
  const suffixSlug = slugifyPart(suffix);

  const base = `${account}-${stackSlug}-${suffixSlug}`;
  const maxLength = options.maxLength;
  return typeof maxLength === 'number' ? withMaxLength(base, maxLength) : base;
}

export function slugifyLabel(label: string): string {
  return slugifyPart(label);
}
