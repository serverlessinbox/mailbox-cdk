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
  deployment: `${TAG_PREFIX}deployment`,
  component: `${TAG_PREFIX}component`,
  version: `${TAG_PREFIX}version`,
  deployer: `${TAG_PREFIX}deployer`,

  edge: `${TAG_PREFIX}edge`,
  originDeployment: `${TAG_PREFIX}origin-deployment`,
  originRegion: `${TAG_PREFIX}origin-region`,
} as const;

export interface ApplyServerlessInboxTagsOptions {
  /** Defaults to 'mailbox'. */
  product?: string;

  /** Defaults to AWS::StackName (the deployed stack name). */
  deployment?: string;

  /** Optional version string (e.g. '1.2.3' or 'channel:dev'). */
  version?: string;

  /** Optional deployer kind ('cfn' by default if provided). */
  deployer?: ServerlessInboxDeployer;

  /** Optional extra tags supplied by the caller. */
  extraTags?: Record<string, string>;
}

export interface ApplyServerlessInboxEdgeTagsOptions {
  originDeployment: string;
  originRegion: string;
}

export function applyServerlessInboxBaseTags(
  scope: IConstruct,
  options: ApplyServerlessInboxTagsOptions = {},
): void {
  const product = (options.product ?? 'mailbox').trim() || 'mailbox';
  const deployment = (options.deployment ?? Aws.STACK_NAME).toString();

  Tags.of(scope).add(ServerlessInboxTagKeys.product, product);
  Tags.of(scope).add(ServerlessInboxTagKeys.deployment, deployment);

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
  Tags.of(scope).add(ServerlessInboxTagKeys.originDeployment, options.originDeployment);
  Tags.of(scope).add(ServerlessInboxTagKeys.originRegion, options.originRegion);
}
