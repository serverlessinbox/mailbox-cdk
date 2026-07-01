import { Aws, Tags } from 'aws-cdk-lib';
import type { IConstruct } from 'constructs';

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

export type ServerlessInboxDeployer = 'cdk' | 'cfn' | 'marketplace';

const TAG_PREFIX = 'serverless-inbox:' as const;

export const ServerlessInboxTagKeys = {
  product: `${TAG_PREFIX}product`,
  /** Main (root) stack name — shared across all stacks in a deployment for cross-stack correlation. */
  rootStack: `${TAG_PREFIX}root-stack`,
  /** This stack's own name (AWS::StackName). */
  stack: `${TAG_PREFIX}stack`,
  component: `${TAG_PREFIX}component`,
  description: `${TAG_PREFIX}description`,
  version: `${TAG_PREFIX}version`,
  deployer: `${TAG_PREFIX}deployer`,

  edge: `${TAG_PREFIX}edge`,
  rootRegion: `${TAG_PREFIX}root-region`,
} as const;

export interface ApplyServerlessInboxTagsOptions {
  /** Defaults to 'mailbox'. */
  product?: string;

  /**
   * Main (root) stack name, shared across all stacks in a deployment for cross-stack correlation.
   * Tagged as `serverless-inbox:root-stack`. This stack's own name is tagged separately as
   * `serverless-inbox:stack` (from AWS::StackName).
   */
  rootStack: string;

  /** Optional version string (e.g. '1.2.3' or 'channel:dev'). */
  version?: string;

  /** Optional deployer kind ('cfn' by default if provided). */
  deployer?: ServerlessInboxDeployer;

  /** Optional extra tags supplied by the caller. */
  extraTags?: Record<string, string>;
}

export interface ApplyServerlessInboxEdgeTagsOptions {
  /** The root stack's region (where the main stack is deployed). Tagged as `serverless-inbox:root-region`. */
  rootRegion: string;
}

export function applyServerlessInboxBaseTags(
  scope: IConstruct,
  options: ApplyServerlessInboxTagsOptions,
): void {
  const product = (options.product ?? 'mailbox').trim() || 'mailbox';

  Tags.of(scope).add(ServerlessInboxTagKeys.product, product);
  // Correlation scheme: root-stack is the shared main stack name; stack is this stack's own name.
  Tags.of(scope).add(ServerlessInboxTagKeys.rootStack, options.rootStack);
  Tags.of(scope).add(ServerlessInboxTagKeys.stack, Aws.STACK_NAME);

  if (options.version) {
    Tags.of(scope).add(ServerlessInboxTagKeys.version, options.version);
  }

  if (options.deployer) {
    Tags.of(scope).add(ServerlessInboxTagKeys.deployer, options.deployer);
  }

  const extra = options.extraTags ?? {};
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === null) continue;
    const v = String(value).trim();
    if (!v) continue;
    Tags.of(scope).add(key, v);
  }
}

export function applyServerlessInboxComponentTag(scope: IConstruct, component: ServerlessInboxComponent): void {
  Tags.of(scope).add(ServerlessInboxTagKeys.component, component);
}

export function applyServerlessInboxEdgeTags(scope: IConstruct, options: ApplyServerlessInboxEdgeTagsOptions): void {
  Tags.of(scope).add(ServerlessInboxTagKeys.edge, 'true');
  // root-stack is set by applyServerlessInboxBaseTags; only the root-region back-reference is added here.
  Tags.of(scope).add(ServerlessInboxTagKeys.rootRegion, options.rootRegion);
}
