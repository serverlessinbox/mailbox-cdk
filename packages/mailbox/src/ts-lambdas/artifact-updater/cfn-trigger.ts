import { wrapHandler } from 'aws-custom-resources';
import { runUpdateCycle } from './update-cycle';

/**
 * CloudFormation custom resource handler (stack-self-update, Phase B).
 *
 * Synchronously runs the artifact update cycle before responding to CloudFormation.
 * The serviceTimeout configured in the CDK construct (600s) covers this synchronous cost.
 *
 * Errors propagate uncaught out of the handler; wrapHandler converts them to CFN FAILED responses.
 * Logging is handled by LoggerBuffer in runUpdateCycle(), which flushes on error before rethrowing.
 */
export const cfnTriggerHandler = wrapHandler(async (event) => {
  await runUpdateCycle();

  return {
    PhysicalResourceId: event.LogicalResourceId,
    Data: {},
  };
});
