import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import { LoggerBuffer } from './logger-buffer';

/**
 * Detects whether the parent CloudFormation stack is currently rolling back.
 *
 * During a rollback, CloudFormation sends custom-resource Update handlers the old properties
 * and expects SUCCESS responses. Answering FAILED during rollback leaves the stack in
 * UPDATE_ROLLBACK_FAILED, which is undeletable without manual intervention.
 *
 * This detector enables handlers to suppress errors and return SUCCESS when rolling back,
 * allowing the rollback to proceed cleanly.
 *
 * The client parameter is primarily for testing; at runtime a client is created automatically.
 * The logger parameter lets the calling handler capture this detector's trace in its own
 * buffered logger instead of writing unconditionally to the console.
 */
export async function isParentStackRollingBack(
  stackId: string,
  cfnClient?: CloudFormationClient,
  logger?: LoggerBuffer,
): Promise<boolean> {
  const client = cfnClient || new CloudFormationClient();

  try {
    const response = await client.send(
      new DescribeStacksCommand({ StackName: stackId }),
    );

    const stack = response.Stacks?.[0];
    if (!stack) {
      return false;
    }

    // Check if the stack is in a rollback-in-progress state
    const status = stack.StackStatus;
    return status === 'UPDATE_ROLLBACK_IN_PROGRESS';
  } catch (err) {
    // If DescribeStacks fails (stack not found, permission denied, etc.),
    // treat it as "not rolling back" so the handler proceeds with normal error handling.
    // Log at warn level so the failure is visible in the trace if it gets flushed.
    const message = err instanceof Error ? err.message : String(err);
    logger?.warn(`Failed to check parent stack status: ${message}`);
    return false;
  }
}
