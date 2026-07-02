import { wrapHandler } from 'aws-custom-resources';
import { LambdaClient, GetFunctionCommand, DeleteFunctionCommand } from '@aws-sdk/client-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import type { CloudFormationCustomResourceHandler } from 'aws-lambda';

const sfnClient = new SFNClient({ region: process.env.AWS_REGION });

export interface SweepTarget {
  kind: 'core-acm-cert' | 'edge-lambda-fn';
  arn: string;
  rootStackName: string;
}

export interface SweepExecutionInput {
  targets: SweepTarget[];
}

export interface WorkerInput extends SweepTarget {
  workerLambdaArn?: string;
  workerRoleArn?: string;
  workerRolePolicyName?: string;
  stateMachineArn?: string;
  executionRoleArn?: string;
  rolePolicyName?: string;
}

export interface WorkerOutput {
  done: boolean;
}

/**
 * Starter handler: fires a Step Functions execution to sweep deferred resources.
 * Called by CloudFormation custom resource (DeferredRemoval) on Create/Update/Delete.
 *
 * - Create: no-op (no resource to sweep yet)
 * - Update with ARN change: sweeps the old ARN
 * - Delete: sweeps the resource ARN
 *
 * Wrapped with wrapHandler to guarantee CloudFormation response always sent;
 * sweep runs asynchronously. StartExecution failures are logged but do not
 * prevent the custom resource from completing (best-effort).
 */
export const starterHandler: CloudFormationCustomResourceHandler = wrapHandler(async (event) => {
  console.log('Starter invoked', {
    requestType: event.RequestType,
    requestId: event.RequestId,
    logicalResourceId: event.LogicalResourceId,
  });

  const resourceArn = event.ResourceProperties['ResourceArn'] as string | undefined;
  const resourceKind = event.ResourceProperties['ResourceKind'] as string | undefined;
  const rootStackName = process.env['MAILBOX_SWEEPER_ROOT_STACK_NAME']!;
  const smArn = process.env['MAILBOX_SWEEPER_STATE_MACHINE_ARN']!;

  // Determine which ARN to sweep
  // wrapHandler's event type doesn't expose OldResourceProperties, but it's present in Update events
  const cfnEvent = event as any;
  const isReplaced =
    event.RequestType === 'Update' &&
    cfnEvent.OldResourceProperties?.['ResourceArn'] !== resourceArn;
  const arnToSweep =
    event.RequestType === 'Delete' ? resourceArn :
    isReplaced ? cfnEvent.OldResourceProperties?.['ResourceArn'] :
      null;

  const arnToSweepKind =
    event.RequestType === 'Delete' ? resourceKind :
    isReplaced ? cfnEvent.OldResourceProperties?.['ResourceKind'] :
      null;

  console.log('Determining sweep target', {
    requestType: event.RequestType,
    resourceArn,
    oldResourceArn: cfnEvent.OldResourceProperties?.['ResourceArn'],
    isReplaced,
    arnToSweep,
    arnToSweepKind,
  });

  // Physical resource ID: use current ARN if available, fall back to RequestId.
  // This ensures Update→Delete retries can identify the resource correctly.
  const physicalResourceId = resourceArn || event.RequestId;

  // Fire the execution if there's something to sweep.
  // Failures are logged but do NOT throw; wrapHandler guarantees a response.
  if (arnToSweep && arnToSweep !== '' && arnToSweepKind) {
    try {
      const executionInput: SweepExecutionInput = {
        targets: [{ kind: arnToSweepKind as 'core-acm-cert' | 'edge-lambda-fn', arn: arnToSweep, rootStackName }],
      };

      console.log('Starting SFN execution', { executionName: event.RequestId, stateMachineArn: smArn });

      await sfnClient.send(new StartExecutionCommand({
        stateMachineArn: smArn,
        name: event.RequestId,
        input: JSON.stringify(executionInput),
      }));

      console.log('SFN execution started successfully');
    } catch (err: any) {
      // ExecutionAlreadyExists means the execution is already running (likely a retry)
      if (err.name === 'ExecutionAlreadyExists') {
        console.log('Execution already exists (likely a retry); treating as success');
      } else {
        // Any other error: log but do NOT throw. Delete must always succeed so
        // CloudFormation never hangs waiting for a response.
        console.warn('Failed to start SFN execution (best-effort, will not propagate):', {
          errorName: err?.name,
          errorMessage: err?.message,
        });
      }
    }
  } else {
    console.log('No sweep target; skipping execution start (Create or Update with unchanged ARN)');
  }

  // Return response object. wrapHandler will always send this to CloudFormation,
  // even if the function threw an uncaught error (which we don't have here).
  return {
    PhysicalResourceId: physicalResourceId,
    Data: {},
  };
});

/**
 * Worker handler: invoked by Step Functions for edge-lambda-fn targets only.
 * The worker deletes Lambda@Edge functions in us-east-1 (cross-region).
 * ACM cert deletion is handled by the SFN's own CallAwsService (same-region).
 *
 * - Uses a Lambda client configured for us-east-1
 * - Verifies the function's serverless-inbox:root-stack tag matches the expected stack
 * - Deletes the function; returns { done: true } on success or ResourceNotFoundException
 * - Returns { done: false } on any other error (e.g., replicas still draining)
 */
export const workerHandler = async (input: WorkerInput): Promise<WorkerOutput> => {
  console.log('Worker invoked', {
    kind: input.kind,
    arn: input.arn,
    rootStackName: input.rootStackName,
  });

  // Only the worker handles edge-lambda-fn; ACM is handled by SFN CallAwsService
  if (input.kind !== 'edge-lambda-fn') {
    console.log('Ignoring non-lambda target; SFN handles it');
    return { done: true };
  }

  const lambdaClient = new LambdaClient({ region: 'us-east-1' });

  try {
    // Extract function name from ARN (last segment)
    // Format: arn:aws:lambda:us-east-1:ACCOUNT:function:FUNCTION-NAME
    const functionName = input.arn.split(':').pop()!;

    // First, verify the function exists and has the correct ownership tag
    console.log('Verifying function ownership via GetFunction', { functionName });
    const getResp = await lambdaClient.send(new GetFunctionCommand({ FunctionName: functionName }));
    const tags = getResp.Tags ?? {};
    const ownerStackName = tags['serverless-inbox:root-stack'];

    if (ownerStackName !== input.rootStackName) {
      console.warn('Function ownership mismatch', {
        functionName,
        expectedStack: input.rootStackName,
        actualStack: ownerStackName,
      });
      // Mismatch: do not delete; return not-done so the caller retries
      return { done: false };
    }

    // Ownership verified; proceed to delete
    console.log('Ownership verified; attempting delete', { functionName });
    await lambdaClient.send(new DeleteFunctionCommand({ FunctionName: functionName }));

    console.log('Function deleted successfully', { functionName });
    return { done: true };
  } catch (err: any) {
    // ResourceNotFoundException means the function is already gone (or was never ours)
    if (err.name === 'ResourceNotFoundException') {
      console.log('Function not found; treating as deleted', { arn: input.arn });
      return { done: true };
    }

    // Any other error: return not-done to trigger a retry
    // Common cases: replicas still draining, permission errors, throttling
    console.warn('Worker error (will retry)', {
      arn: input.arn,
      errorName: err.name,
      errorMessage: err.message,
    });
    return { done: false };
  }
};
