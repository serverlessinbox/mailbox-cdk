import { Aws, Tags } from 'aws-cdk-lib';
import type { IConstruct } from 'constructs';
import { resolveDeployerType } from './deployer-type';
import type { ServerlessInboxDeployerType } from './deployer-type';

export type ServerlessInboxComponent =
  | 'auth'
  | 'data'
  | 'ui'
  | 'edge'
  | 'api'
  | 'email'
  | 'ops'
  | 'storage'
  | 'search'
  | 'messaging';

const TAG_PREFIX = 'serverless-inbox:' as const;

export const ServerlessInboxTagKeys = {
  product: `${TAG_PREFIX}product`,
  /** Main (root) stack name — shared across all stacks in a deployment for cross-stack correlation. */
  rootStack: `${TAG_PREFIX}root-stack`,
  /** This stack's own name (AWS::StackName). */
  stack: `${TAG_PREFIX}stack`,
  component: `${TAG_PREFIX}component`,
  description: `${TAG_PREFIX}description`,
  /** Construct/CDK suite version (generic — every deployment has one). */
  version: `${TAG_PREFIX}version`,
  /**
   * Published *template* version — present ONLY on template-based deployments (e.g. the standard app),
   * stamped by that app's release pipeline. This is the axis the human-gated ChangeSet self-update
   * compares against; distinct from `version` (the construct version).
   */
  templateVersion: `${TAG_PREFIX}template-version`,
  deployerType: `${TAG_PREFIX}deployer_type`,

  edge: `${TAG_PREFIX}edge`,
  rootRegion: `${TAG_PREFIX}root-region`,

  artifactName: `${TAG_PREFIX}artifact-name`,
  artifactPackage: `${TAG_PREFIX}artifact-package`,
  artifactVersion: `${TAG_PREFIX}artifact-version`,
  autoUpdateType: `${TAG_PREFIX}auto-update-type`,
  bucketName: `${TAG_PREFIX}bucket-name`,
} as const;

export interface ApplyServerlessInboxTagsOptions {
  /** Defaults to 'mailbox'. */
  readonly product?: string;

  /**
   * Main (root) stack name, shared across all stacks in a deployment for cross-stack correlation.
   * Tagged as `serverless-inbox:root-stack`. This stack's own name is tagged separately as
   * `serverless-inbox:stack` (from AWS::StackName).
   */
  readonly rootStack: string;

  /** Optional version string (e.g. '1.2.3' or 'channel:dev'). */
  readonly version?: string;

  /** Optional extra tags supplied by the caller. */
  readonly extraTags?: Record<string, string>;
}

export interface ApplyServerlessInboxEdgeTagsOptions {
  /** The root stack's region (where the main stack is deployed). Tagged as `serverless-inbox:root-region`. */
  readonly rootRegion: string;
}

function applyServerlessInboxTags(
  scope: IConstruct,
  options: ApplyServerlessInboxTagsOptions,
  deployerType: ServerlessInboxDeployerType,
): void {
  const product = (options.product ?? 'mailbox').trim() || 'mailbox';

  Tags.of(scope).add(ServerlessInboxTagKeys.product, product);
  // Correlation scheme: root-stack is the shared main stack name; stack is this stack's own name.
  Tags.of(scope).add(ServerlessInboxTagKeys.rootStack, options.rootStack);
  Tags.of(scope).add(ServerlessInboxTagKeys.stack, Aws.STACK_NAME);

  if (options.version) {
    Tags.of(scope).add(ServerlessInboxTagKeys.version, options.version);
  }

  Tags.of(scope).add(ServerlessInboxTagKeys.deployerType, deployerType);

  const extra = options.extraTags ?? {};
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === null) continue;
    const v = String(value).trim();
    if (!v) continue;
    Tags.of(scope).add(key, v);
  }
}

export function applyServerlessInboxBaseTags(
  scope: IConstruct,
  options: ApplyServerlessInboxTagsOptions,
): void {
  applyServerlessInboxTags(scope, options, resolveDeployerType(scope));
}

/**
 * Internal-only variant for sub-stack templates synthesized standalone (their own `new App()`,
 * no CDK context) — `resolveDeployerType` would silently resolve to the 'cdk' fallback there, so
 * the caller passes the value it already has from its own CfnParameter instead. Not re-exported
 * from packages/mailbox/src/index.ts — never reaches the published surface.
 */
export function applyServerlessInboxBaseTagsWithDeployerType(
  scope: IConstruct,
  options: ApplyServerlessInboxTagsOptions,
  deployerType: ServerlessInboxDeployerType,
): void {
  applyServerlessInboxTags(scope, options, deployerType);
}

export function applyServerlessInboxComponentTag(scope: IConstruct, component: ServerlessInboxComponent): void {
  Tags.of(scope).add(ServerlessInboxTagKeys.component, component);
}

export interface ServerlessInboxSubStackTagOptions {
  /** Root (main) stack name shared across the deployment. */
  readonly rootStack: string;
  /** This sub-stack's own CloudFormation stack name. */
  readonly stack: string;
  /** Product version (e.g. '1.2.3' or 'channel:dev'). */
  readonly version?: string;
  /** Defaults to 'mailbox'. */
  readonly product?: string;
}

/**
 * Builds the object-level tag map applied to a sub-stack's AWS::CloudFormation::Stack via the
 * deployer's CreateStack/UpdateStack `Tags` parameter (correlation scheme: root-stack + stack +
 * product + version). Keys use the canonical `serverless-inbox:` prefix.
 */
export function serverlessInboxSubStackTags(
  options: ServerlessInboxSubStackTagOptions,
): Record<string, string> {
  const tags: Record<string, string> = {
    [ServerlessInboxTagKeys.product]: (options.product ?? 'mailbox').trim() || 'mailbox',
    [ServerlessInboxTagKeys.rootStack]: options.rootStack,
    [ServerlessInboxTagKeys.stack]: options.stack,
  };
  if (options.version) {
    tags[ServerlessInboxTagKeys.version] = options.version;
  }
  return tags;
}

export function applyServerlessInboxEdgeTags(scope: IConstruct, options: ApplyServerlessInboxEdgeTagsOptions): void {
  Tags.of(scope).add(ServerlessInboxTagKeys.edge, 'true');
  // root-stack is set by applyServerlessInboxBaseTags; only the root-region back-reference is added here.
  Tags.of(scope).add(ServerlessInboxTagKeys.rootRegion, options.rootRegion);
}

/**
 * IAM condition-key/value pair gating on the root-stack RESOURCE tag (an already-tagged resource's
 * own tags), keyed under `aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`. Callers spread the
 * result into a `StringEquals` (or similar) condition block alongside any other keys. `value` must be
 * the exact value the caller uses today (e.g. `Aws.STACK_NAME` or a `rootStack`/`rootStackTagValue`
 * parameter) — there is no default, since the two are not interchangeable when a stack has an
 * explicit name.
 */
export function rootStackResourceTagCondition(value: string): Record<string, string> {
  return { [`aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`]: value };
}

/**
 * IAM condition-key/value pair gating on the root-stack REQUEST tag (the tag value being written by
 * the current request, e.g. on create or first tag-write), keyed under
 * `aws:RequestTag/${ServerlessInboxTagKeys.rootStack}`. Callers spread the result into a
 * `StringEquals` (or similar) condition block alongside any other keys. `value` must be the exact
 * value the caller uses today — there is no default.
 */
export function rootStackRequestTagCondition(value: string): Record<string, string> {
  return { [`aws:RequestTag/${ServerlessInboxTagKeys.rootStack}`]: value };
}
