import type { IArtifactResolver }                        from '@serverlessinbox/artifact-registry-cdk';
import { Template }                                      from 'aws-cdk-lib/assertions';
import { Construct }                                     from 'constructs';
import * as t                                            from 'typanion';

import { DeployerWorkerLambda }                          from '../resources/lambdas/deployer-worker-lambda';

import { statementsForAction, type PolicyStatementJson } from './policy-statements';
import { newProbeStack }                                 from './probe-stack';

const isTagKeysConstraint = t.isObject({ 'aws:TagKeys': t.isArray(t.isString()) });

/** A deployer worker whose only grant is the tagging API, with no tag keys beyond the shared ones. */
class SharedTaggingWorker extends DeployerWorkerLambda {
  constructor(scope: Construct, artifactResolver: IArtifactResolver) {
    super(scope, 'worker', { artifactResolver, deployedStackName: 'probe' });
    this.grantTaggingApi();
  }
}

/**
 * The tag-key patterns a statement allows through `ForAllValues:StringLike` on `aws:TagKeys`; a statement
 * without that constraint throws.
 */
export function tagKeysOf(statement: PolicyStatementJson): string[] {
  const errors: string[] = [];
  const constraint       = statement.Condition?.['ForAllValues:StringLike'];
  if (!isTagKeysConstraint(constraint, { errors })) {
    throw new Error(`Statement has no ForAllValues:StringLike constraint on aws:TagKeys: ${errors.join('; ')}`);
  }
  return constraint['aws:TagKeys'];
}

/**
 * The `aws:TagKeys` patterns the shared deployer worker admits for tag writes, read from a worker that adds
 * none. A worker test compares against this instead of repeating the list, so the list is pinned only by the
 * shared worker's own test.
 */
export function sharedSubStackTagKeys(): string[] {
  const { stack, artifactResolver } = newProbeStack();
  new SharedTaggingWorker(stack, artifactResolver);

  const statements = statementsForAction(Template.fromStack(stack), 'tag:TagResources');
  if (statements.length !== 1) {
    throw new Error(`Expected one tag:TagResources statement from the shared worker, found ${statements.length}`);
  }
  return tagKeysOf(statements[0]);
}
