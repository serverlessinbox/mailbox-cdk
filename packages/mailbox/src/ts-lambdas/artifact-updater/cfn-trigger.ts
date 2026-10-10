import { wrapHandler } from 'aws-custom-resources';
import { emitManualFinalize } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { UpdaterRuntime } from './updater-runtime';
import { runUpdateCycle } from './update-cycle';

/**
 * CloudFormation custom resource handler for the deploy-end trigger of the artifact updater.
 *
 * Synchronously runs the artifact update cycle before responding to CloudFormation.
 * The serviceTimeout configured in the CDK construct (600s) covers this synchronous cost.
 *
 * If the artifact update cycle fails, the error is caught to prevent a CFN FAILED response.
 * Errors are logged by LoggerBuffer in runUpdateCycle(), which flushes to CloudWatch before
 * rethrowing. The handler catches and swallows the error (allowing deployment to continue),
 * with full failure details captured in CloudWatch.
 *
 * On Delete, the handler returns immediately without running the update cycle and does no
 * other work. CloudFormation also sends Delete when it removes or replaces the resource, a
 * teardown after which a full update cycle would only be a redundant second cycle.
 *
 * A configuration error on Create/Update fails the custom resource (unlike an update-cycle
 * failure, which is swallowed). Delete still returns SUCCESS so the stack can be deleted.
 *
 * PhysicalResourceId is omitted from the Delete response on purpose: wrapHandler's internal
 * getPhysicalResourceId() falls back to the real incoming event's PhysicalResourceId for
 * Update/Delete requests, so CloudFormation sees the same id it already knows about. (The
 * TypeSafeCloudFormationResourceEvent type wrapHandler exposes to this callback collapses
 * aws-lambda's discriminated union to its common fields via Omit<>, so PhysicalResourceId
 * isn't reachable here even after narrowing on RequestType === 'Delete' -- relying on the
 * wrapper's own fallback avoids needing an unsound cast to reach it.)
 */
export function createCfnTriggerHandler(runtime: UpdaterRuntime) {
  return wrapHandler(async (event) => {
    // Emit finalization details for manual recovery of hung custom resources
    emitManualFinalize(event, { service: runtime.config.serviceName });

    if (event.RequestType === 'Delete') {
      return {
        Data: {},
      };
    }

    if (runtime.error !== undefined) {
      // Config error on Create/Update fails the custom resource (unlike an update-cycle failure, which is swallowed).
      throw new Error(runtime.error);
    }

    try {
      await runUpdateCycle(runtime.config, runtime.clients);
    } catch (err: unknown) {
      // runUpdateCycle() already logged the error via LoggerBuffer and flushed it to CloudWatch
      // before rethrowing. We catch here to prevent CFN FAILED and allow deployment to continue.
    }

    return {
      PhysicalResourceId: event.LogicalResourceId,
      Data: {},
    };
  });
}
