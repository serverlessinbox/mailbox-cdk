import type { LambdaClient } from '@aws-sdk/client-lambda';
import { InvokeCommand } from '@aws-sdk/client-lambda';

/**
 * Dispatch an async self-invoke to run the update cycle.
 * Fire-and-forget: invokes with an empty payload that falls through to runUpdateCycle() on re-entry.
 * Reused by both CFN CR ack-early path and HTTP POST /trigger.
 */
export async function dispatchSelfInvoke(lambdaClient: LambdaClient): Promise<void> {
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME || '';

  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'Event', // async invoke
      Payload: JSON.stringify({}),
    }),
  );
}
