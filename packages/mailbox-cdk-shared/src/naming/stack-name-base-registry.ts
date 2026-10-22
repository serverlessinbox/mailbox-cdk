import { IResolvable, Stack } from 'aws-cdk-lib';
import { IConstruct }         from 'constructs';

/**
 * The S3-safe name base (a CDK token or string) of each stack, keyed by the stack's construct node.
 * Different stacks, or several instances of one stack in an app, each hold their own entry.
 * Both `setStackNameBase` and `getStackNameBase` normalize to the actual Stack via `Stack.of()`,
 * so any construct in the stack can be passed and the same key is used for all lookups.
 */
const registryMap = new WeakMap<IConstruct['node'], string | IResolvable>();

/**
 * Register an S3-safe name base for a Stack.
 *
 * Setting the same stack's name base twice with different values throws an error.
 * Only call this once per stack.
 *
 * @param stack Any construct in the Stack; will be normalized to the actual Stack
 * @param nameBase The S3-safe name base (typically a derived token or string)
 * @throws Error if a different value is already registered for this stack
 */
export function setStackNameBase(stack: IConstruct, nameBase: string | IResolvable): void {
  const stackNode = Stack.of(stack).node;
  const existing  = registryMap.get(stackNode);

  if (existing !== undefined) {
    // Registering the identical value again is allowed; any other value is rejected.
    if (existing === nameBase) {
      return;
    }

    throw new Error(
      `Stack name base already registered for ${stackNode.path}. ` +
      'Setting it twice with different values is not permitted. ' +
      `Existing: ${String(existing)}. New: ${String(nameBase)}.`
    );
  }

  registryMap.set(stackNode, nameBase);
}

/**
 * Retrieve the registered S3-safe name base for a Stack, if one exists.
 *
 * Returns undefined if no name base has been registered for this stack.
 *
 * @param stack Any construct in the Stack; will be normalized to the actual Stack
 * @returns The registered name base (string or IResolvable), or undefined
 */
export function getStackNameBase(stack: IConstruct): string | IResolvable | undefined {
  return registryMap.get(Stack.of(stack).node);
}
