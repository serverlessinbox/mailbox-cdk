import { Construct } from 'constructs';

/**
 * Get-or-create a shared group construct at stack root.
 * Used by singleton constructs (e.g. StaticContentDeployer, BucketAutoEmpty, StackHelpers)
 * to place themselves under a common "shared" parent, allowing multiple instances to coexist
 * under one logical group.
 */
export function getOrCreateSharedGroup(stack: Construct): Construct {
  const existing = stack.node.tryFindChild('shared');
  if (existing) return existing as Construct;
  return new Construct(stack, 'shared');
}
