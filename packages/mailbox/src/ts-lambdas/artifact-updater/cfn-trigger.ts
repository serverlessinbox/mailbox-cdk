import { wrapHandler } from 'aws-custom-resources';
import { runUpdateCycle } from './update-cycle';

/**
 * CloudFormation custom resource handler (stack-self-update, Phase B).
 *
 * Synchronously runs the artifact update cycle before responding to CloudFormation.
 * The serviceTimeout configured in the CDK construct (600s) covers this synchronous cost.
 *
 * If the artifact update cycle fails, the error is caught to prevent a CFN FAILED response.
 * Errors are logged by LoggerBuffer in runUpdateCycle(), which flushes to CloudWatch before
 * rethrowing. The handler catches and swallows the error (allowing deployment to continue),
 * with full failure details captured in CloudWatch.
 */
export const cfnTriggerHandler = wrapHandler(async (event) => {
  try {
    await runUpdateCycle();
  } catch (err: unknown) {
    // runUpdateCycle() already logged the error via LoggerBuffer and flushed it to CloudWatch
    // before rethrowing. We catch here to prevent CFN FAILED and allow deployment to continue.
  }

  return {
    PhysicalResourceId: event.LogicalResourceId,
    Data: {},
  };
});
