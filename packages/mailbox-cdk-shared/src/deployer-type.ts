import { Construct } from 'constructs';
import { DEPLOYER_TYPE_CONTEXT_KEY } from './context-keys';

export type ServerlessInboxDeployerType = 'cdk' | 'cfn' | 'marketplace';

/**
 * Resolve the deployment mechanism used to deploy this stack.
 *
 * Reads the DEPLOYER_CONTEXT_KEY CDK context key, falling back to 'cdk' when unset — a customer
 * install passes no CDK context at all, so absence must never throw. Throws when the context
 * value is present but not one of the recognized deployer kinds.
 *
 * Called once from a composition root (`Mailbox`, or an addon's own top-level construct) and
 * threaded down as a prop — never called from a Lambda construct class.
 *
 * @param scope Construct used to read CDK context.
 * @returns The resolved deployer kind.
 * @throws Error if the context value is present but not one of: cdk, cfn, marketplace.
 */
export function resolveDeployerType(scope: Construct): ServerlessInboxDeployerType {
  const v = scope.node.tryGetContext(DEPLOYER_TYPE_CONTEXT_KEY);
  if (v === 'cdk' || v === 'cfn' || v === 'marketplace') return v;
  if (v !== undefined && v !== null) {
    throw new Error(
      `@serverlessinbox/mailbox: invalid CDK context value for "${DEPLOYER_TYPE_CONTEXT_KEY}": "${v}". ` +
      'Must be one of: cdk, cfn, marketplace.',
    );
  }
  return 'cdk';
}
