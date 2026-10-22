import { Aws, Tags }                        from 'aws-cdk-lib';
import type { IConstruct }                  from 'constructs';

import { resolveDeployerType }              from '../context/deployer-type';
import type { ServerlessInboxDeployerType } from '../context/deployer-type';
import { StackIdentity }                    from '../naming/stack-identity';
import { ServerlessInboxTagKeys }           from '../runtime/handler-kit/tag-keys';

/** The component of the deployment a resource belongs to, written as its `serverless-inbox:component` tag. */
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

export interface ApplyServerlessInboxTagsOptions {
  /** Defaults to 'mailbox'. */
  readonly product?: string;

  /**
   * Main (root) stack name, shared across all stacks in a deployment for cross-stack correlation.
   * Tagged as `serverless-inbox:root-stack`. This stack's own name is tagged separately as
   * `serverless-inbox:stack` (from AWS::StackName).
   */
  readonly rootStack: string;

  /** Optional extra tags supplied by the caller. */
  readonly extraTags?: Record<string, string>;
}

/** The back-reference to the root stack's region that an edge stack's resources carry. */
export interface ApplyServerlessInboxEdgeTagsOptions {
  /** The root stack's region (where the main stack is deployed). Tagged as `serverless-inbox:root-region`. */
  readonly rootRegion: string;
}

/** What `serverlessInboxSubStackTags` builds a sub-stack's tags from. */
export interface ServerlessInboxSubStackTagOptions {
  /** Root (main) stack name shared across the deployment. */
  readonly rootStack: string;
  /** Root (main) stack's unique id, the guid of its stack id. */
  readonly rootStackId: string;
  /** This sub-stack's own CloudFormation stack name. */
  readonly stack: string;
  /** Defaults to 'mailbox'. */
  readonly product?: string;
}

/** The tags of a sub-stack's `AWS::CloudFormation::Stack`: the correlation scheme's product, root stack, root stack id and stack keys. */
export type ServerlessInboxSubStackTags = {
  readonly [ServerlessInboxTagKeys.product]:     string;
  readonly [ServerlessInboxTagKeys.rootStack]:   string;
  readonly [ServerlessInboxTagKeys.rootStackId]: string;
  readonly [ServerlessInboxTagKeys.stack]:       string;
};

/** The root stack whose resources a grant admits: its name as tagged under `root-stack`, and its guid as tagged under `root-stack-id`. */
export interface RootStack {
  readonly name: string;
  readonly id:   string;
}

/** The `Condition` block of one IAM statement a root-stack tag check produces. */
export interface RootStackConditions {
  /** The tag value the resource, or the request, must carry. */
  readonly StringEquals: Record<string, string>;
  /** Present on the name statement: the id tag must be absent. */
  readonly Null?: Record<string, string>;
}

/** The two statements' conditions that together admit the resources the root stack owns. */
export type RootStackConditionPair = readonly [RootStackConditions, RootStackConditions];

/**
 * Tags `scope` with the correlation tags of the deployment: the product, the root stack, the root stack's
 * id, this stack and the deployer type resolved from the CDK context, then the caller's extra tags.
 */
export function applyServerlessInboxBaseTags(
  scope: IConstruct,
  options: ApplyServerlessInboxTagsOptions,
): void {
  applyServerlessInboxBaseTagsWithDeployerType(scope, options, resolveDeployerType(scope), StackIdentity.guid);
}

/**
 * The base tags with the deployer type and the root stack's id given instead of resolved. A sub-stack
 * template synthesized standalone (its own `new App()`, no CDK context) would silently resolve the
 * deployer type to the 'cdk' fallback, so the caller passes the value it already has from its own
 * CfnParameter. A sub-stack is not the root stack, so the caller also passes the root stack's id it
 * received as a parameter (`rootStackId`), never its own.
 */
export function applyServerlessInboxBaseTagsWithDeployerType(
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

  Tags.of(scope).add(ServerlessInboxTagKeys.deployerType, deployerType);

  const extra = options.extraTags ?? {};
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === null) {continue;}
    const v = String(value).trim();
    if (!v) {continue;}
    Tags.of(scope).add(key, v);
  }
}

/** Tags `scope` with the component of the deployment it belongs to. */
export function applyServerlessInboxComponentTag(scope: IConstruct, component: ServerlessInboxComponent): void {
  Tags.of(scope).add(ServerlessInboxTagKeys.component, component);
}

/**
 * Builds the object-level tag map applied to a sub-stack's AWS::CloudFormation::Stack via the
 * deployer's CreateStack/UpdateStack `Tags` parameter (correlation scheme: root-stack + stack +
 * product). Keys use the canonical `serverless-inbox:` prefix.
 */
export function serverlessInboxSubStackTags(
  options: ServerlessInboxSubStackTagOptions,
): ServerlessInboxSubStackTags {
  return {
    [ServerlessInboxTagKeys.product]:     (options.product ?? 'mailbox').trim() || 'mailbox',
    [ServerlessInboxTagKeys.rootStack]:   options.rootStack,
    [ServerlessInboxTagKeys.rootStackId]: options.rootStackId,
    [ServerlessInboxTagKeys.stack]:       options.stack,
  };
}

/** Marks `scope` as part of the edge stack and records the region of the root stack it belongs to. */
export function applyServerlessInboxEdgeTags(scope: IConstruct, options: ApplyServerlessInboxEdgeTagsOptions): void {
  Tags.of(scope).add(ServerlessInboxTagKeys.edge, 'true');
  Tags.of(scope).add(ServerlessInboxTagKeys.rootRegion, options.rootRegion);
}

/**
 * The conditions of the two statements that together admit the resources the root stack owns:
 * the first admits a resource whose RESOURCE tag `root-stack-id` equals the root stack's id, the second a
 * resource that has no `root-stack-id` tag and whose `root-stack` tag equals the root stack's name. IAM
 * grants on the union of statements, so a caller adds one statement per element, spreading it into
 * its own conditions next to any keys under other operators.
 */
export function rootStackResourceTagConditions(rootStack: RootStack): RootStackConditionPair {
  return rootStackConditions('aws:ResourceTag', rootStack);
}

/**
 * The same two conditions over the REQUEST tag (the tags written by the current request, e.g. on
 * create or first tag-write): the request carries the root stack's id, or carries no id and the root stack's name.
 */
export function rootStackRequestTagConditions(rootStack: RootStack): RootStackConditionPair {
  return rootStackConditions('aws:RequestTag', rootStack);
}

function rootStackConditions(
  keyPrefix: 'aws:ResourceTag' | 'aws:RequestTag',
  rootStack: RootStack,
): RootStackConditionPair {
  const idKey   = `${keyPrefix}/${ServerlessInboxTagKeys.rootStackId}`;
  const nameKey = `${keyPrefix}/${ServerlessInboxTagKeys.rootStack}`;
  return [
    { StringEquals: { [idKey]: rootStack.id } },
    { StringEquals: { [nameKey]: rootStack.name }, Null: { [idKey]: 'true' } },
  ];
}
