import { wrapHandler } from 'aws-custom-resources';
import { emitManualFinalize } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
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
 *
 * On Delete, the handler returns immediately without running the update cycle and does no
 * other work. This resource's construct id was bumped (see TrackedUpdateTriggers in
 * auto-updater.ts) to force CloudFormation to create the new resource and then delete the old
 * one on the next deploy; running a full update cycle on that teardown Delete would be a
 * spurious, redundant second cycle, so it's skipped entirely.
 *
 * PhysicalResourceId is omitted from the Delete response on purpose: wrapHandler's internal
 * getPhysicalResourceId() falls back to the real incoming event's PhysicalResourceId for
 * Update/Delete requests, so CloudFormation sees the same id it already knows about. (The
 * TypeSafeCloudFormationResourceEvent type wrapHandler exposes to this callback collapses
 * aws-lambda's discriminated union to its common fields via Omit<>, so PhysicalResourceId
 * isn't reachable here even after narrowing on RequestType === 'Delete' -- relying on the
 * wrapper's own fallback avoids needing an unsound cast to reach it.)
 */
export function createCfnTriggerHandler(service?: string) {
  return wrapHandler(async (event) => {
    // Emit finalization details for manual recovery of hung custom resources
    emitManualFinalize(event, { service });

    if (event.RequestType === 'Delete') {
      return {
        Data: {},
      };
    }

    try {
      await runUpdateCycle(service);
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
