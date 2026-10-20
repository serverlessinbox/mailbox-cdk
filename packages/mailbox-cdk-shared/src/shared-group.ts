import { Aws }                          from 'aws-cdk-lib';
import { Construct }                    from 'constructs';

import { applyServerlessInboxBaseTags } from './serverless-inbox-tags';

/**
 * Get-or-create a shared group construct at stack root.
 * Used by singleton constructs (e.g. StaticContentDeployer, BucketAutoEmpty, StackHelpers)
 * to place themselves under a common "shared" parent, allowing multiple instances to coexist
 * under one logical group.
 */
export function getOrCreateSharedGroup(stack: Construct): Construct {
  const existing = stack.node.tryFindChild('shared');
  if (existing) {return existing as Construct;}

  const shared = new Construct(stack, 'shared');

  // Parented directly on the Stack, so a Tags aspect registered on `Mailbox` never visits this
  // subtree — tag here, once, rather than per child.
  applyServerlessInboxBaseTags(shared, { rootStack: Aws.STACK_NAME });

  return shared;
}
