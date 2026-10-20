import { Aws, Tags }                        from 'aws-cdk-lib';
import type { IConstruct }                  from 'constructs';

import { resolveDeployerType }              from '../context/deployer-type';
import type { ServerlessInboxDeployerType } from '../context/deployer-type';
import { StackIdentity }                    from '../naming/stack-identity';
import { ServerlessInboxTagKeys }           from '../ts-lambdas/shared/tag-keys';

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

export { ServerlessInboxTagKeys };

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
  rootStackId: string,
): void {
  const product = (options.product ?? 'mailbox').trim() || 'mailbox';

  Tags.of(scope).add(ServerlessInboxTagKeys.product, product);
  // Correlation scheme: root-stack is the shared main stack name; stack is this stack's own name.
  Tags.of(scope).add(ServerlessInboxTagKeys.rootStack, options.rootStack);
  Tags.of(scope).add(ServerlessInboxTagKeys.rootStackId, rootStackId);
  Tags.of(scope).add(ServerlessInboxTagKeys.stack, Aws.STACK_NAME);

  if (options.version) {
    Tags.of(scope).add(ServerlessInboxTagKeys.version, options.version);
  }

  Tags.of(scope).add(ServerlessInboxTagKeys.deployerType, deployerType);

  const extra = options.extraTags ?? {};
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === null) {continue;}
    const v = String(value).trim();
    if (!v) {continue;}
    Tags.of(scope).add(key, v);
  }
}

export function applyServerlessInboxBaseTags(
  scope: IConstruct,
  options: ApplyServerlessInboxTagsOptions,
): void {
  applyServerlessInboxTags(scope, options, resolveDeployerType(scope), StackIdentity.guid);
}

/**
 * Internal-only variant for sub-stack templates synthesized standalone (their own `new App()`,
 * no CDK context) — `resolveDeployerType` would silently resolve to the 'cdk' fallback there, so
 * the caller passes the value it already has from its own CfnParameter instead. A sub-stack is
 * not the root stack, so the caller also passes the root stack's id it received as a parameter
 * (`rootStackId`), never its own. Not re-exported
 * from packages/mailbox/src/index.ts — never reaches the published surface.
 */
export function applyServerlessInboxBaseTagsWithDeployerType(
  scope: IConstruct,
  options: ApplyServerlessInboxTagsOptions,
  deployerType: ServerlessInboxDeployerType,
  rootStackId: string,
): void {
  applyServerlessInboxTags(scope, options, deployerType, rootStackId);
}

export function applyServerlessInboxComponentTag(scope: IConstruct, component: ServerlessInboxComponent): void {
  Tags.of(scope).add(ServerlessInboxTagKeys.component, component);
}

export interface ServerlessInboxSubStackTagOptions {
  /** Root (main) stack name shared across the deployment. */
  readonly rootStack: string;
  /** Root (main) stack's unique id, the guid of its stack id. */
  readonly rootStackId: string;
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
    [ServerlessInboxTagKeys.rootStackId]: options.rootStackId,
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

/** The root stack whose resources a grant admits: its name as tagged under `root-stack`, and its guid as tagged under `root-stack-id`. */
export interface RootStack {
  readonly name: string;
  readonly id: string;
}

/** The `Condition` block of one IAM statement: operator to condition-key/value map. */
export type RootStackConditions =Record<string, Record<string, string>>;

/**
 * The conditions of the two statements that together admit the resources the root stack owns:
 * the first admits a resource whose RESOURCE tag `root-stack-id` equals the root stack's id, the second a
 * resource that has no `root-stack-id` tag and whose `root-stack` tag equals the root stack's name. IAM
 * grants on the union of statements, so a caller adds one statement per element, spreading it into
 * its own conditions next to any keys under other operators.
 */
export function rootStackResourceTagConditions(rootStack: RootStack): readonly [RootStackConditions, RootStackConditions] {
  return rootStackConditions('aws:ResourceTag', rootStack);
}

/**
 * The same two conditions over the REQUEST tag (the tags written by the current request, e.g. on
 * create or first tag-write): the request carries the root stack's id, or carries no id and the root stack's name.
 */
export function rootStackRequestTagConditions(rootStack: RootStack): readonly [RootStackConditions, RootStackConditions] {
  return rootStackConditions('aws:RequestTag', rootStack);
}

function rootStackConditions(
  keyPrefix: 'aws:ResourceTag' | 'aws:RequestTag',
  rootStack: RootStack,
): readonly [RootStackConditions, RootStackConditions] {
  const idKey   = `${keyPrefix}/${ServerlessInboxTagKeys.rootStackId}`;
  const nameKey = `${keyPrefix}/${ServerlessInboxTagKeys.rootStack}`;
  return [
    { StringEquals: { [idKey]: rootStack.id } },
    { StringEquals: { [nameKey]: rootStack.name }, Null: { [idKey]: 'true' } },
  ];
}
