/**
 * IAM Test Helpers — Shared interfaces, constants, and utility functions
 *
 * Used by both mailbox-data-stack.test.ts and mailbox-edge-stack.test.ts
 * for CloudFormation template introspection and IAM policy analysis.
 */

import * as t from 'typanion';

const isCloudFormationTags = t.isArray(t.isObject({
  Key:   t.isString(),
  Value: t.isOneOf([t.isString(), t.isPartial({ Ref: t.isOptional(t.isString()), 'Fn::Sub': t.isOptional(t.isString()) })]),
}));

export type CloudFormationTag = t.InferType<typeof isCloudFormationTags>[number];

export interface CloudFormationResource {
  Type:        string;
  Properties?: Record<string, unknown>;
}

/**
 * ALLOWLIST: IAM wildcard statements that legitimately cannot be scoped by tag/name.
 * Each entry is pre-verified to be essential and scoped by Condition or Service Principal.
 * Format: service:action -> reason, condition (if any).
 *
 * When a test fails on a wildcard, verify it's not a regression: check if it's in this list,
 * and if not, review the security implication before adding it.
 */
export const KNOWN_WILDCARDS: Record<string, string> = {
  // CloudFormation needs to read/list any resource to manage stacks
  'cloudformation:GetTemplateSummary':  'CloudFormation resource introspection (read-only)',
  'cloudformation:DescribeStackEvents': 'CloudFormation stack event retrieval (read-only)',

  // Resource Groups Tagging API - scoped to read+tag ops; no dangerous write
  'tag:GetResources':   'Resource Groups Tagging API (read-only, no delete)',
  'tag:TagResources':   'Resource Groups Tagging API (tag writes, broad scope accepted)',
  'tag:UntagResources': 'Resource Groups Tagging API (tag removal, broad scope accepted)',

  // CloudFormation ACM provisioning - RequestCertificate cannot be scoped by tag (cert created untagged)
  'acm:RequestCertificate':     'ACM cert creation (certificate ARN random, cannot be pre-scoped)',
  'acm:DescribeCertificate':    'ACM cert read (informational, no delete)',
  'acm:ListTagsForCertificate': 'ACM cert tags read (informational)',

  // ResourceGroups CreateGroup cannot be scoped (group ARN validation unverified)
  'resource-groups:CreateGroup': 'Resource Group creation (group ARN scoping unverified; group name deterministic)',

  // CloudFormation resource introspection
  'iam:GetRole':                  'IAM role read (informational)',
  'iam:ListRolePolicies':         'IAM role policy enumeration (informational)',
  'iam:ListAttachedRolePolicies': 'IAM role policy attachment read (informational)',
  'iam:GetRolePolicy':            'IAM inline policy read (informational)',

  // Lambda read-only operations on any function
  'lambda:GetFunction':            'Lambda function metadata read (informational)',
  'lambda:ListVersionsByFunction': 'Lambda version enumeration (informational)',

  // CloudWatch Logs creation - broad scope same as AWS managed policies
  'logs:CreateLogGroup':  'CloudWatch log group creation (standard Lambda execution permission)',
  'logs:CreateLogStream': 'CloudWatch log stream creation (standard Lambda execution permission)',
  'logs:PutLogEvents':    'CloudWatch log event writes (standard Lambda execution permission)',
};

export function getTagValue(tag: CloudFormationTag): CloudFormationTag['Value'] {
  return tag.Value;
}

/** The tags of the resource, or undefined when it has none. A `Tags` property that is not a list of key/value tags fails the test with what was wrong. */
export function readTags(resource: CloudFormationResource): CloudFormationTag[] | undefined {
  const tags = resource.Properties?.Tags;
  if (tags === undefined) {
    return undefined;
  }

  const errors: string[] = [];
  if (!isCloudFormationTags(tags, { errors })) {
    throw new Error(`The Tags of a ${resource.Type} are not a list of key/value tags: ${errors.join('; ')}`);
  }
  return tags;
}

export function isResourceOfType(resource: CloudFormationResource, type: string): boolean {
  return resource.Type === type;
}
