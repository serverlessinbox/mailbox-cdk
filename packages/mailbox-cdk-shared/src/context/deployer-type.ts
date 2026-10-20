import { Construct }                 from 'constructs';
import * as t                        from 'typanion';

import { DEPLOYER_TYPE_CONTEXT_KEY } from './context-keys';

const DEPLOYER_TYPES = ['cdk', 'cfn', 'marketplace'] as const;

const isDeployerType = t.isEnum(DEPLOYER_TYPES);

export type ServerlessInboxDeployerType = (typeof DEPLOYER_TYPES)[number];

/**
 * The deployment mechanism of this stack, read from the `DEPLOYER_TYPE_CONTEXT_KEY` CDK context key.
 * An unset key resolves to 'cdk': a customer install passes no CDK context at all, so absence must
 * never throw.
 *
 * @throws Error if the key is set to anything but a deployer type.
 */
export function resolveDeployerType(scope: Construct): ServerlessInboxDeployerType {
  const configured: unknown = scope.node.tryGetContext(DEPLOYER_TYPE_CONTEXT_KEY);
  if (configured === undefined || configured === null) {
    return 'cdk';
  }

  if (!isDeployerType(configured)) {
    throw new Error(
      `@serverlessinbox/mailbox: invalid CDK context value for "${DEPLOYER_TYPE_CONTEXT_KEY}": "${configured}". ` +
      `Must be one of: ${DEPLOYER_TYPES.join(', ')}.`,
    );
  }

  return configured;
}
