import { CfnResource, RemovalPolicy } from 'aws-cdk-lib';
import type { IConstruct }            from 'constructs';

/**
 * The CloudFormation resource behind an L2 construct. A construct without one throws at synth: the
 * caller needs the resource itself, and carrying on without it would silently skip what it was for.
 */
export function defaultCfnResource(construct: IConstruct): CfnResource {
  const resource = construct.node.defaultChild;
  if (resource === undefined || !CfnResource.isCfnResource(resource)) {
    throw new Error(`${construct.node.path}: expected its default child to be a CfnResource, found ${resource?.node.path ?? 'none'}`);
  }
  return resource;
}

/**
 * Applies RETAIN_ON_UPDATE_OR_DELETE to the CloudFormation resource behind `construct`. A retention
 * that did not apply is a resource CloudFormation deletes, so a construct that cannot be retained
 * fails the synth instead of deploying unprotected.
 */
export function retainOnUpdateOrDelete(construct: IConstruct): void {
  defaultCfnResource(construct).applyRemovalPolicy(RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);
}
