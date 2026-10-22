import { Aws }                          from 'aws-cdk-lib';
import { Construct }                    from 'constructs';

import { applyServerlessInboxBaseTags } from './serverless-inbox-tags';

/**
 * Get-or-create the "shared" group construct at stack root: the common parent of the constructs that
 * exist once per stack.
 */
export function getOrCreateSharedGroup(stack: Construct): Construct {
  const existing = stack.node.tryFindChild('shared');
  if (existing !== undefined && Construct.isConstruct(existing)) {return existing;}

  const shared = new Construct(stack, 'shared');

  // Parented directly on the stack, outside the scope of an aspect registered on a construct below it,
  // so the base tags are applied here once instead of per child.
  applyServerlessInboxBaseTags(shared, { rootStack: Aws.STACK_NAME });

  return shared;
}
